import { CELL_COUNT, cellToGrid, distance, isValidCell, neighbors } from './grid.js';
import { hasLineOfSight } from './lineOfSight.js';
import { blocksLineOfSight, isWalkable, type GameMap } from './map.js';
import { applyTackle, beginTurn, hurt, leaveBoard, passTurn, resolveSpell, settle } from './engine.js';
import {
  TEAMS,
  activeFighter,
  cloneFight,
  computeTurnOrder,
  effectiveStats,
  fighterAt,
  getFighter,
  mapStartCells,
  type FightError,
  type FightEvent,
  type FightResult,
  type FightState,
  type Fighter,
  type FighterSetup,
  type SpellUsage,
  type Team,
} from './fightState.js';
import { shuffle, type Rng } from './rng.js';
import type { Spell, SpellGrade } from './spell.js';
import { zoneCells } from './zone.js';

/**
 * Fight actions (design doc, Tactical combat > Fight sequence, and Spells >
 * Casting rules).
 *
 * Every action is a pure function: it takes a state and returns either an error
 * or a new state plus the events it produced, in order. The input state is never
 * changed, so the AI can try actions freely and the server can validate an
 * intent before committing it. Events are what the client animates and the
 * server broadcasts. Timers (placement, turn) belong to the caller, which calls
 * `startFight` or `endTurn` when they run out. Actions that roll dice take an Rng.
 */

const fail = (error: FightError): FightResult => ({ ok: false, error });

// ---------------------------------------------------------------------------
// Placement

export interface CreateFightOptions {
  /** Overrides the start cells flagged on the map. */
  startCells?: Record<Team, number[]>;
  /** Every spell fighters in this fight may carry. */
  spells?: readonly Spell[];
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
    spells: Object.fromEntries((options.spells ?? []).map((sp) => [sp.id, sp])),
    startCells: { A: [...start.A], B: [...start.B] },
    phase: 'placement',
    fighters: [],
    turnOrder: [],
    turnIndex: 0,
    round: 0,
    winner: null,
    fallen: [],
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
  const slots = setup.spells ?? [];
  const spellUsage: Record<string, SpellUsage> = {};
  for (const slot of slots) {
    const grade = state.spells[slot.spellId]?.grades[slot.grade - 1];
    if (!grade || spellUsage[slot.spellId]) return fail('unknown-spell');
    spellUsage[slot.spellId] = { castableFromTurn: 1 + grade.initialCooldown, castsThisTurn: 0, castsOnTarget: {} };
  }
  const free = state.startCells[setup.team].filter((c) => !fighterAt(state, c));
  const cell = shuffle(rng, free)[0];
  if (cell === undefined) return fail('no-free-start-cell');

  const maxHp = setup.stats.maxHp;
  const next = cloneFight(state);
  next.fighters.push({
    id: setup.id,
    name: setup.name,
    team: setup.team,
    controller: setup.controller,
    stats: structuredStats(setup),
    hp: Math.min(maxHp, Math.max(1, Math.floor(setup.hp ?? maxHp))),
    ap: setup.stats.ap,
    mp: setup.stats.mp,
    cell,
    status: 'alive',
    spells: slots.map((slot) => ({ ...slot })),
    spellUsage,
    turns: 0,
    buffs: [],
    ...(setup.ai && { ai: { ...setup.ai } }),
  });
  return { ok: true, state: next, events: [{ type: 'joined', fighterId: setup.id, cell }] };
}

/** A copy of the setup's stats that shares nothing with the caller. */
function structuredStats({ stats }: FighterSetup): Fighter['stats'] {
  return {
    ...stats,
    damage: { ...stats.damage },
    resistPercent: { ...stats.resistPercent },
    resistFlat: { ...stats.resistFlat },
  };
}

/** Moves a fighter to another start cell of its team, swapping with the ally standing there. */
export function placeFighter(state: FightState, fighterId: string, cell: number): FightResult {
  if (state.phase !== 'placement') return fail('wrong-phase');
  const f = getFighter(state, fighterId);
  if (!f) return fail('unknown-fighter');
  if (!state.startCells[f.team].includes(cell)) return fail('not-a-start-cell');
  if (f.cell === cell) return { ok: true, state, events: [] };

  const next = cloneFight(state);
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

  const next = cloneFight(state);
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
  const next = cloneFight(state);
  const events: FightEvent[] = [];
  passTurn(next, events);
  return { ok: true, state: next, events };
}

/**
 * Walks the active fighter along `path` (the cells to step through, excluding its
 * own cell, as returned by findPath). Steps are orthogonal, 1 MP each, onto
 * walkable cells free of fighters. Leaving a cell next to enemies costs MP and
 * AP by tackle; if that leaves no MP for the next step, the walk stops there.
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

  const next = cloneFight(state);
  const mover = getFighter(next, fighterId)!;
  const events: FightEvent[] = [];
  let walked: number[] = [];
  const flush = () => {
    if (walked.length) events.push({ type: 'moved', fighterId, path: walked });
    walked = [];
  };
  for (const c of path) {
    const tackleEvents: FightEvent[] = [];
    applyTackle(next, mover, tackleEvents);
    if (tackleEvents.length) {
      flush();
      events.push(...tackleEvents);
    }
    if (mover.mp < 1) break;
    mover.cell = c;
    mover.mp--;
    walked.push(c);
  }
  flush();
  return { ok: true, state: next, events };
}

/** A player gives up on its own turn. It leaves the board and counts as dead. */
export function flee(state: FightState, fighterId: string): FightResult {
  const error = checkTurn(state, fighterId);
  if (error) return fail(error);
  if (getFighter(state, fighterId)!.controller !== 'player') return fail('cannot-flee');

  const next = cloneFight(state);
  const f = getFighter(next, fighterId)!;
  const events: FightEvent[] = [{ type: 'fled', fighterId, cell: f.cell }];
  leaveBoard(next, f, 'fled');
  settle(next, events);
  return { ok: true, state: next, events };
}

/**
 * Takes `amount` HP from a fighter, as a final value (no resistances): shields
 * absorb first. At 0 HP the fighter dies and leaves the board; if it was its
 * own turn, play passes on.
 * Spells deal damage through castSpell; this is for everything else.
 */
export function applyDamage(state: FightState, fighterId: string, amount: number): FightResult {
  if (state.phase !== 'fighting') return fail('wrong-phase');
  const target = getFighter(state, fighterId);
  if (!target) return fail('unknown-fighter');
  if (target.status !== 'alive') return fail('not-alive');

  const next = cloneFight(state);
  const events: FightEvent[] = [];
  hurt(next, getFighter(next, fighterId)!, amount, events);
  settle(next, events);
  return { ok: true, state: next, events };
}

// ---------------------------------------------------------------------------
// Spells

/** The grade a fighter carries a spell at, or undefined if the spell is not on its bar. */
export function spellGradeOf(state: FightState, fighter: Fighter, spellId: string): SpellGrade | undefined {
  const slot = fighter.spells.find((s) => s.spellId === spellId);
  return slot && state.spells[spellId]?.grades[slot.grade - 1];
}

/** Min and max range of a grade for this fighter: +Range (with buffs) applies when boostable, never below the min. */
export function spellRange(fighter: Fighter, grade: SpellGrade): { min: number; max: number } {
  const bonus = grade.rangeBoostable ? effectiveStats(fighter).range : 0;
  return { min: grade.minRange, max: Math.max(grade.minRange, grade.maxRange + bonus) };
}

/**
 * Why the fighter cannot cast this spell right now, whatever the target, or
 * null if it can: its turn, the spell on its bar, AP, cooldown, casts per turn.
 * The spell bar greys out spells on this.
 */
export function spellError(state: FightState, fighterId: string, spellId: string): FightError | null {
  const error = checkTurn(state, fighterId);
  if (error) return error;
  const f = getFighter(state, fighterId)!;
  const grade = spellGradeOf(state, f, spellId);
  const usage = f.spellUsage[spellId];
  if (!grade || !usage) return 'unknown-spell';
  if (f.ap < grade.apCost) return 'not-enough-ap';
  if (f.turns < usage.castableFromTurn) return 'on-cooldown';
  if (grade.castsPerTurn > 0 && usage.castsThisTurn >= grade.castsPerTurn) return 'cast-limit';
  return null;
}

function inRange(from: number, range: { min: number; max: number }, cell: number): boolean {
  const d = distance(from, cell);
  return d >= range.min && d <= range.max;
}

/** The castInLine / castInDiagonal rule: a grid axis or an exact grid diagonal of the caster. */
function fitsLineRule(from: number, grade: SpellGrade, cell: number): boolean {
  if (!grade.castInLine && !grade.castInDiagonal) return true;
  const a = cellToGrid(from);
  const b = cellToGrid(cell);
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  return (grade.castInLine && (dx === 0 || dy === 0)) || (grade.castInDiagonal && dx === dy);
}

/**
 * Why the fighter cannot cast this spell on `cell`, or null if it can. On top
 * of spellError: the cell must be a walkable map cell within range, on a line
 * or diagonal if the spell asks for one, free if it needs a free cell, under
 * the per-target limit, and in line of sight if needed. Map obstacles and
 * fighters block line of sight; the target cell never does.
 */
export function castError(state: FightState, fighterId: string, spellId: string, cell: number): FightError | null {
  const error = spellError(state, fighterId, spellId);
  if (error) return error;
  const f = getFighter(state, fighterId)!;
  const grade = spellGradeOf(state, f, spellId)!;
  if (!isValidCell(cell) || !isWalkable(state.map, cell)) return 'invalid-target';
  if (!inRange(f.cell, spellRange(f, grade), cell)) return 'out-of-range';
  if (!fitsLineRule(f.cell, grade, cell)) return 'not-in-line';
  const target = fighterAt(state, cell);
  if (grade.needsFreeCell && target) return 'cell-occupied';
  const castsOnTarget = target ? (f.spellUsage[spellId]!.castsOnTarget[target.id] ?? 0) : 0;
  if (grade.castsPerTarget > 0 && castsOnTarget >= grade.castsPerTarget) return 'target-limit';
  if (grade.needsLineOfSight) {
    const blocks = (c: number) => blocksLineOfSight(state.map, c) || fighterAt(state, c) !== undefined;
    if (!hasLineOfSight(f.cell, cell, blocks)) return 'no-line-of-sight';
  }
  return null;
}

/**
 * Walkable cells inside the spell's range and line/diagonal rule, before line
 * of sight and units are considered. With castableCells, the client shows
 * cells in range that cannot be targeted right now.
 */
export function spellRangeCells(state: FightState, fighterId: string, spellId: string): number[] {
  const f = getFighter(state, fighterId);
  const grade = f && spellGradeOf(state, f, spellId);
  if (!f || !grade || f.cell === -1) return [];
  const range = spellRange(f, grade);
  const out: number[] = [];
  for (let c = 0; c < CELL_COUNT; c++) {
    if (isWalkable(state.map, c) && inRange(f.cell, range, c) && fitsLineRule(f.cell, grade, c)) out.push(c);
  }
  return out;
}

/**
 * Cells a cast on `cell` would cover: the union of the areas of the grade's
 * normal effects, centre first. The client shows this under the cursor.
 */
export function spellAreaCells(state: FightState, fighterId: string, spellId: string, cell: number): number[] {
  const f = getFighter(state, fighterId);
  const grade = f && spellGradeOf(state, f, spellId);
  if (!f || !grade) return [];
  const out = new Set<number>();
  for (const e of grade.effects) {
    if (e.targets.includes('cell') || e.targets.includes('caster')) out.add(cell);
    else for (const c of zoneCells(e.zone, cell, f.cell)) out.add(c);
  }
  return [...out];
}

/** Cells the fighter can cast this spell on right now. */
export function castableCells(state: FightState, fighterId: string, spellId: string): number[] {
  if (spellError(state, fighterId, spellId)) return [];
  return spellRangeCells(state, fighterId, spellId).filter((c) => castError(state, fighterId, spellId, c) === null);
}

/**
 * Casts a spell on a cell: spends its AP, starts its cooldown, counts the cast
 * towards the per-turn and per-target limits, then rolls the critical hit and
 * applies the effects in order (design doc, Spells > Effects).
 */
export function castSpell(state: FightState, fighterId: string, spellId: string, cell: number, rng: Rng): FightResult {
  const error = castError(state, fighterId, spellId, cell);
  if (error) return fail(error);

  const next = cloneFight(state);
  const f = getFighter(next, fighterId)!;
  const slot = f.spells.find((s) => s.spellId === spellId)!;
  const grade = spellGradeOf(next, f, spellId)!;
  const usage = f.spellUsage[spellId]!;
  f.ap -= grade.apCost;
  usage.castsThisTurn++;
  usage.castableFromTurn = Math.max(usage.castableFromTurn, f.turns + grade.cooldown);
  const target = fighterAt(next, cell);
  if (target) usage.castsOnTarget[target.id] = (usage.castsOnTarget[target.id] ?? 0) + 1;

  const events: FightEvent[] = [];
  resolveSpell(next, f, next.spells[spellId]!, grade, slot.grade, cell, rng, events);
  settle(next, events);
  return { ok: true, state: next, events };
}
