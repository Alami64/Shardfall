import { CELL_COUNT, neighbors } from './grid.js';
import { CellFlag, hasFlag, isWalkable, type GameMap } from './map.js';
import { reachableCells } from './pathfinding.js';
import { shuffle, type Rng } from './rng.js';

/**
 * Fight state: placement, initiative order, turns, AP/MP and end conditions
 * (design doc, Tactical combat > Fight sequence).
 *
 * Every action is a pure function: it takes a state and returns either an error
 * or a new state plus the events it produced, in order. The input state is never
 * changed, so the AI can try actions freely and the server can validate an
 * intent before committing it. Events are what the client animates and the
 * server broadcasts. Timers (placement, turn) belong to the caller, which calls
 * `startFight` or `endTurn` when they run out.
 */

export type Team = 'A' | 'B';
export const TEAMS: readonly Team[] = ['A', 'B'];

export const otherTeam = (team: Team): Team => (team === 'A' ? 'B' : 'A');

export const PLACEMENT_SECONDS = 30;
export const TURN_SECONDS = 30;
/** Share of damage taken that also lowers max HP for the rest of the fight. */
export const EROSION_RATE = 0.1;

/** A fighter's stats as it enters the fight (after gear). */
export interface FighterStats {
  level: number;
  maxHp: number;
  ap: number;
  mp: number;
  /** Bonus initiative from gear and passives. */
  initiative: number;
  strength: number;
  intelligence: number;
  chance: number;
  agility: number;
}

export interface FighterSetup {
  id: string;
  name: string;
  team: Team;
  /** Players can flee; AI fighters cannot. */
  controller: 'player' | 'ai';
  stats: FighterStats;
  /** HP on entering the fight, clamped to 1..maxHp. Defaults to full. */
  hp?: number;
}

export type FighterStatus = 'alive' | 'dead' | 'fled';

export interface Fighter {
  id: string;
  name: string;
  team: Team;
  controller: 'player' | 'ai';
  readonly stats: Readonly<FighterStats>;
  hp: number;
  /** Starts at stats.maxHp; erosion lowers it during the fight. */
  maxHp: number;
  /** Points left this turn. Refilled at the start of the fighter's turn, lost at its end. */
  ap: number;
  mp: number;
  /** Cell id, or -1 once the fighter has left the board (dead or fled). */
  cell: number;
  status: FighterStatus;
}

export type FightPhase = 'placement' | 'fighting' | 'ended';

export interface FightState {
  /** Shared and read-only: fight functions never copy or change it. */
  readonly map: GameMap;
  readonly startCells: Readonly<Record<Team, readonly number[]>>;
  phase: FightPhase;
  /** In join order. */
  fighters: Fighter[];
  /** Fighter ids in order of play, fixed at fight start. Dead fighters keep their slot and are skipped. */
  turnOrder: string[];
  /** Index into turnOrder of the fighter whose turn it is. */
  turnIndex: number;
  /** Starts at 1 and goes up each time the turn order wraps around. 0 during placement. */
  round: number;
  /** Set when the fight ends; null is a draw (both teams wiped out at once). */
  winner: Team | null;
}

export type FightEvent =
  | { type: 'joined'; fighterId: string; cell: number }
  | { type: 'placed'; fighterId: string; cell: number }
  | { type: 'fightStarted'; turnOrder: string[] }
  | { type: 'turnStarted'; fighterId: string; round: number }
  | { type: 'moved'; fighterId: string; path: number[] }
  | { type: 'turnEnded'; fighterId: string }
  | { type: 'damaged'; fighterId: string; amount: number; erosion: number; hp: number }
  | { type: 'died'; fighterId: string; cell: number }
  | { type: 'fled'; fighterId: string; cell: number }
  | { type: 'fightEnded'; winner: Team | null };

export type FightError =
  | 'wrong-phase'
  | 'duplicate-fighter'
  | 'unknown-fighter'
  | 'no-free-start-cell'
  | 'not-a-start-cell'
  | 'missing-team'
  | 'not-your-turn'
  | 'not-alive'
  | 'cannot-flee'
  | 'empty-path'
  | 'invalid-path'
  | 'cell-occupied'
  | 'not-enough-mp';

export type FightResult =
  | { ok: true; state: FightState; events: FightEvent[] }
  | { ok: false; error: FightError };

const fail = (error: FightError): FightResult => ({ ok: false, error });

/** Copies everything an action may change; the map and start cells stay shared. */
function draft(state: FightState): FightState {
  return {
    ...state,
    fighters: state.fighters.map((f) => ({ ...f })),
    turnOrder: [...state.turnOrder],
  };
}

// ---------------------------------------------------------------------------
// Queries

export function getFighter(state: FightState, id: string): Fighter | undefined {
  return state.fighters.find((f) => f.id === id);
}

/** The fighter whose turn it is, or undefined outside the fighting phase. */
export function activeFighter(state: FightState): Fighter | undefined {
  if (state.phase !== 'fighting') return undefined;
  const id = state.turnOrder[state.turnIndex];
  return id === undefined ? undefined : getFighter(state, id);
}

/** The fighter standing on a cell, if any. */
export function fighterAt(state: FightState, cell: number): Fighter | undefined {
  return state.fighters.find((f) => f.cell === cell && f.status === 'alive');
}

/** Start cells as flagged on the map. */
export function mapStartCells(map: GameMap): Record<Team, number[]> {
  const out: Record<Team, number[]> = { A: [], B: [] };
  for (let c = 0; c < CELL_COUNT; c++) {
    if (hasFlag(map, c, CellFlag.StartTeamA)) out.A.push(c);
    if (hasFlag(map, c, CellFlag.StartTeamB)) out.B.push(c);
  }
  return out;
}

/**
 * Initiative = (bonus + Str + Int + Cha + Agi) × currentHP / maxHP, rounded down,
 * so a wounded fighter plays later.
 */
export function initiativeOf(fighter: Fighter): number {
  const s = fighter.stats;
  const total = s.initiative + s.strength + s.intelligence + s.chance + s.agility;
  return Math.floor((total * fighter.hp) / fighter.maxHp);
}

/**
 * Order of play: each team sorted by initiative, then alternating teams, starting
 * with the team whose best fighter has the highest initiative (highest of A,
 * highest of B, and so on). When one team runs out, the rest of the other team
 * follows. Ties, within a team or for the first slot, are broken by the RNG.
 */
export function computeTurnOrder(fighters: readonly Fighter[], rng: Rng): string[] {
  const sorted = (team: Team) =>
    // Shuffle first: the sort is stable, so equal initiatives end up in random order.
    shuffle(rng, fighters.filter((f) => f.team === team)).sort((a, b) => initiativeOf(b) - initiativeOf(a));
  const a = sorted('A');
  const b = sorted('B');
  const topA = a[0] ? initiativeOf(a[0]) : -Infinity;
  const topB = b[0] ? initiativeOf(b[0]) : -Infinity;
  const aFirst = topA > topB || (topA === topB && rng() < 0.5);
  const [first, second] = aFirst ? [a, b] : [b, a];

  const order: string[] = [];
  for (let i = 0; i < Math.max(first.length, second.length); i++) {
    if (first[i]) order.push(first[i]!.id);
    if (second[i]) order.push(second[i]!.id);
  }
  return order;
}

/** Cells a fighter can reach with its remaining MP, mapped to their MP cost. Fighters block movement. */
export function movementRange(state: FightState, fighterId: string): Map<number, number> {
  const f = getFighter(state, fighterId);
  if (!f || f.status !== 'alive' || f.cell === -1) return new Map();
  return reachableCells(
    f.cell,
    f.mp,
    (c) => isWalkable(state.map, c),
    (c) => fighterAt(state, c) !== undefined,
  );
}

// ---------------------------------------------------------------------------
// Placement

export interface CreateFightOptions {
  /** Overrides the start cells flagged on the map. */
  startCells?: Record<Team, number[]>;
}

/** Opens a fight in the placement phase and places every fighter on a random free start cell of its team. */
export function createFight(
  map: GameMap,
  setups: readonly FighterSetup[],
  rng: Rng,
  options: CreateFightOptions = {},
): FightResult {
  const start = options.startCells ?? mapStartCells(map);
  let state: FightState = {
    map,
    startCells: { A: [...start.A], B: [...start.B] },
    phase: 'placement',
    fighters: [],
    turnOrder: [],
    turnIndex: 0,
    round: 0,
    winner: null,
  };
  const events: FightEvent[] = [];
  for (const setup of setups) {
    const r = joinFight(state, setup, rng);
    if (!r.ok) return r;
    state = r.state;
    events.push(...r.events);
  }
  return { ok: true, state, events };
}

/** Adds a fighter during placement, on a random free start cell of its team. */
export function joinFight(state: FightState, setup: FighterSetup, rng: Rng): FightResult {
  if (state.phase !== 'placement') return fail('wrong-phase');
  if (getFighter(state, setup.id)) return fail('duplicate-fighter');
  const free = state.startCells[setup.team].filter((c) => !fighterAt(state, c));
  const cell = shuffle(rng, free)[0];
  if (cell === undefined) return fail('no-free-start-cell');

  const maxHp = setup.stats.maxHp;
  const next = draft(state);
  next.fighters.push({
    id: setup.id,
    name: setup.name,
    team: setup.team,
    controller: setup.controller,
    stats: { ...setup.stats },
    hp: Math.min(maxHp, Math.max(1, Math.floor(setup.hp ?? maxHp))),
    maxHp,
    ap: setup.stats.ap,
    mp: setup.stats.mp,
    cell,
    status: 'alive',
  });
  return { ok: true, state: next, events: [{ type: 'joined', fighterId: setup.id, cell }] };
}

/** Moves a fighter to another start cell of its team, swapping with the ally standing there. */
export function placeFighter(state: FightState, fighterId: string, cell: number): FightResult {
  if (state.phase !== 'placement') return fail('wrong-phase');
  const f = getFighter(state, fighterId);
  if (!f) return fail('unknown-fighter');
  if (!state.startCells[f.team].includes(cell)) return fail('not-a-start-cell');
  if (f.cell === cell) return { ok: true, state, events: [] };

  const next = draft(state);
  const mover = getFighter(next, fighterId)!;
  const ally = fighterAt(next, cell);
  if (ally && ally.team !== mover.team) return fail('cell-occupied'); // only if start cells overlap
  const events: FightEvent[] = [];
  if (ally) {
    ally.cell = mover.cell;
    events.push({ type: 'placed', fighterId: ally.id, cell: ally.cell });
  }
  mover.cell = cell;
  events.unshift({ type: 'placed', fighterId: mover.id, cell });
  return { ok: true, state: next, events };
}

/** Ends placement: fixes the turn order and starts the first turn. Each team needs at least one fighter. */
export function startFight(state: FightState, rng: Rng): FightResult {
  if (state.phase !== 'placement') return fail('wrong-phase');
  if (TEAMS.some((t) => !state.fighters.some((f) => f.team === t))) return fail('missing-team');

  const next = draft(state);
  next.phase = 'fighting';
  next.turnOrder = computeTurnOrder(next.fighters, rng);
  next.turnIndex = 0;
  next.round = 1;
  const events: FightEvent[] = [{ type: 'fightStarted', turnOrder: [...next.turnOrder] }];
  beginTurn(next, events);
  return { ok: true, state: next, events };
}

// ---------------------------------------------------------------------------
// Turns

/** Refills the active fighter's AP and MP. Buff and poison ticks will hook in here. */
function beginTurn(state: FightState, events: FightEvent[]): void {
  const f = activeFighter(state)!;
  f.ap = f.stats.ap;
  f.mp = f.stats.mp;
  events.push({ type: 'turnStarted', fighterId: f.id, round: state.round });
}

/** Closes the active fighter's turn (unused points are lost) and starts the next living fighter's. */
function passTurn(state: FightState, events: FightEvent[]): void {
  const current = activeFighter(state)!;
  current.ap = 0;
  current.mp = 0;
  events.push({ type: 'turnEnded', fighterId: current.id });

  let idx = state.turnIndex;
  for (let i = 0; i < state.turnOrder.length; i++) {
    idx++;
    if (idx >= state.turnOrder.length) {
      idx = 0;
      state.round++;
    }
    if (getFighter(state, state.turnOrder[idx]!)?.status === 'alive') break;
  }
  state.turnIndex = idx;
  beginTurn(state, events);
}

/** Ends the fight once a team has nobody left standing. Returns true when it ended. */
function checkEnd(state: FightState, events: FightEvent[]): boolean {
  const standing = TEAMS.filter((t) => state.fighters.some((f) => f.team === t && f.status === 'alive'));
  if (standing.length === TEAMS.length) return false;
  state.phase = 'ended';
  state.winner = standing[0] ?? null;
  events.push({ type: 'fightEnded', winner: state.winner });
  return true;
}

/** Checks that `fighterId` may act now. */
function checkTurn(state: FightState, fighterId: string): FightError | null {
  if (state.phase !== 'fighting') return 'wrong-phase';
  if (!getFighter(state, fighterId)) return 'unknown-fighter';
  if (activeFighter(state)?.id !== fighterId) return 'not-your-turn';
  return null;
}

export function endTurn(state: FightState, fighterId: string): FightResult {
  const error = checkTurn(state, fighterId);
  if (error) return fail(error);
  const next = draft(state);
  const events: FightEvent[] = [];
  passTurn(next, events);
  return { ok: true, state: next, events };
}

/**
 * Walks the active fighter along `path` (the cells to step through, excluding its
 * own cell, as returned by findPath). Steps are orthogonal, 1 MP each, onto
 * walkable cells free of fighters. Tackle is not applied yet.
 */
export function moveFighter(state: FightState, fighterId: string, path: readonly number[]): FightResult {
  const error = checkTurn(state, fighterId);
  if (error) return fail(error);
  if (path.length === 0) return fail('empty-path');
  const f = getFighter(state, fighterId)!;

  let prev = f.cell;
  for (const c of path) {
    if (!neighbors(prev).includes(c) || !isWalkable(state.map, c)) return fail('invalid-path');
    if (fighterAt(state, c)) return fail('cell-occupied');
    prev = c;
  }
  if (path.length > f.mp) return fail('not-enough-mp');

  const next = draft(state);
  const mover = getFighter(next, fighterId)!;
  mover.cell = prev;
  mover.mp -= path.length;
  return { ok: true, state: next, events: [{ type: 'moved', fighterId, path: [...path] }] };
}

/** A player gives up on its own turn. It leaves the board and counts as dead. */
export function flee(state: FightState, fighterId: string): FightResult {
  const error = checkTurn(state, fighterId);
  if (error) return fail(error);
  if (getFighter(state, fighterId)!.controller !== 'player') return fail('cannot-flee');

  const next = draft(state);
  const f = getFighter(next, fighterId)!;
  const events: FightEvent[] = [{ type: 'fled', fighterId, cell: f.cell }];
  f.status = 'fled';
  f.cell = -1;
  if (!checkEnd(next, events)) passTurn(next, events);
  return { ok: true, state: next, events };
}

/**
 * Takes `amount` HP from a fighter (the final value, after resistances) and
 * applies erosion: 10% of the HP lost, rounded down, also comes off max HP. At
 * 0 HP the fighter dies and leaves the board; if it was its own turn, play
 * passes to the next fighter. The spell engine builds on this.
 */
export function applyDamage(state: FightState, fighterId: string, amount: number): FightResult {
  if (state.phase !== 'fighting') return fail('wrong-phase');
  const target = getFighter(state, fighterId);
  if (!target) return fail('unknown-fighter');
  if (target.status !== 'alive') return fail('not-alive');

  const next = draft(state);
  const f = getFighter(next, fighterId)!;
  const dealt = Math.min(f.hp, Math.max(0, Math.floor(amount)));
  const erosion = Math.floor(dealt * EROSION_RATE);
  f.hp -= dealt;
  f.maxHp -= erosion;
  const events: FightEvent[] = [{ type: 'damaged', fighterId, amount: dealt, erosion, hp: f.hp }];

  if (f.hp === 0) {
    events.push({ type: 'died', fighterId, cell: f.cell });
    f.status = 'dead';
    f.cell = -1;
    const wasActive = next.turnOrder[next.turnIndex] === fighterId;
    if (!checkEnd(next, events) && wasActive) passTurn(next, events);
  }
  return { ok: true, state: next, events };
}
