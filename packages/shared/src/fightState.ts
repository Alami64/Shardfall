import { CELL_COUNT } from './grid.js';
import { CellFlag, hasFlag, isWalkable, type GameMap } from './map.js';
import { reachableCells } from './pathfinding.js';
import { shuffle, type Rng } from './rng.js';
import type { Element, Spell } from './spell.js';
import { ELEMENTS } from './spell.js';
import type { ElementStat, FighterStats, ScalarStat } from './stats.js';

/**
 * Fight state types and read-only queries. The actions that change a fight
 * live in fight.ts (design doc, Tactical combat > Fight sequence).
 */

export type Team = 'A' | 'B';
export const TEAMS: readonly Team[] = ['A', 'B'];

export const otherTeam = (team: Team): Team => (team === 'A' ? 'B' : 'A');

export const PLACEMENT_SECONDS = 30;
export const TURN_SECONDS = 30;
/** The state the engine knows about: a rooted fighter cannot be pushed, pulled or swapped. */
export const STATE_ROOTED = 'rooted';

/** A spell on a fighter's bar, at a 1-based grade. */
export interface SpellSlot {
  spellId: string;
  grade: number;
}

/** Per-spell bookkeeping for cooldowns and cast limits. */
export interface SpellUsage {
  /** The caster's own turn number from which the spell can be cast again. */
  castableFromTurn: number;
  castsThisTurn: number;
  /** Casts this turn per target fighter id. */
  castsOnTarget: Record<string, number>;
}

/** What a buff does while it lasts. */
export type BuffKind =
  | { kind: 'stat'; stat: ScalarStat }
  | { kind: 'elementStat'; stat: ElementStat; element: Element | 'all' }
  | { kind: 'state'; state: string }
  | { kind: 'shield' };

/**
 * A timed effect on a fighter: a stat change (negative for debuffs), a state,
 * or a shield. `remaining` counts down at the start of the caster's turns and
 * the buff ends at 0. For a shield, `value` is the HP it still absorbs.
 */
export type Buff = BuffKind & {
  casterId: string;
  spellId: string;
  value: number;
  remaining: number;
};

export interface FighterSetup {
  id: string;
  name: string;
  team: Team;
  /** Players can flee; AI fighters cannot. */
  controller: 'player' | 'ai';
  stats: FighterStats;
  /** HP on entering the fight, clamped to 1..maxHp. Defaults to full. */
  hp?: number;
  /** Spells the fighter can cast; each must be in the fight's spell catalogue. */
  spells?: SpellSlot[];
}

export type FighterStatus = 'alive' | 'dead' | 'fled';

export interface Fighter {
  id: string;
  name: string;
  team: Team;
  controller: 'player' | 'ai';
  /** Stats on entering the fight. Use effectiveStats for the values with buffs. */
  readonly stats: Readonly<FighterStats>;
  /** Between 0 and stats.maxHp. */
  hp: number;
  /** Points left this turn. Refilled at the start of the fighter's turn, lost at its end. */
  ap: number;
  mp: number;
  /** Cell id, or -1 once the fighter has left the board (dead or fled). */
  cell: number;
  status: FighterStatus;
  readonly spells: readonly SpellSlot[];
  spellUsage: Record<string, SpellUsage>;
  /** Number of its own turns the fighter has started; 1 during its first turn. */
  turns: number;
  /** Buffs, debuffs, states and shields on this fighter, oldest first. */
  buffs: Buff[];
}

export type FightPhase = 'placement' | 'fighting' | 'ended';

export interface FightState {
  /** Shared and read-only: fight functions never copy or change it. */
  readonly map: GameMap;
  /** Spell catalogue by id, shared and read-only like the map. */
  readonly spells: Readonly<Record<string, Spell>>;
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

export type DisplacementReason = 'push' | 'pull' | 'teleport' | 'swap';

export type FightEvent =
  | { type: 'joined'; fighterId: string; cell: number }
  | { type: 'placed'; fighterId: string; cell: number }
  | { type: 'fightStarted'; turnOrder: string[] }
  | { type: 'turnStarted'; fighterId: string; round: number }
  | { type: 'moved'; fighterId: string; path: number[] }
  | { type: 'tackled'; fighterId: string; cell: number; apLost: number; mpLost: number }
  | { type: 'spellCast'; fighterId: string; spellId: string; grade: number; cell: number; critical: boolean }
  | { type: 'damaged'; fighterId: string; amount: number; hp: number }
  | { type: 'shieldHit'; fighterId: string; absorbed: number; remaining: number }
  | { type: 'healed'; fighterId: string; amount: number; hp: number }
  | { type: 'displaced'; fighterId: string; path: number[]; reason: DisplacementReason }
  | { type: 'pointsRemoved'; fighterId: string; points: 'ap' | 'mp'; removed: number; dodged: number }
  | { type: 'pointsChanged'; fighterId: string; points: 'ap' | 'mp'; amount: number }
  | { type: 'buffAdded'; fighterId: string; buff: Buff }
  | { type: 'buffExpired'; fighterId: string; buff: Buff }
  | { type: 'turnEnded'; fighterId: string }
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
  | 'not-enough-mp'
  | 'unknown-spell'
  | 'not-enough-ap'
  | 'on-cooldown'
  | 'cast-limit'
  | 'target-limit'
  | 'invalid-target'
  | 'out-of-range'
  | 'not-in-line'
  | 'no-line-of-sight';

export type FightResult =
  | { ok: true; state: FightState; events: FightEvent[] }
  | { ok: false; error: FightError };

/**
 * A copy of everything an action may change, so the copy can be edited freely.
 * The map, spell catalogue and start cells stay shared.
 */
export function cloneFight(state: FightState): FightState {
  return {
    ...state,
    fighters: state.fighters.map((f) => ({
      ...f,
      spellUsage: cloneUsage(f.spellUsage),
      buffs: f.buffs.map((b) => ({ ...b })),
    })),
    turnOrder: [...state.turnOrder],
  };
}

function cloneUsage(usage: Record<string, SpellUsage>): Record<string, SpellUsage> {
  const out: Record<string, SpellUsage> = {};
  for (const [id, u] of Object.entries(usage)) out[id] = { ...u, castsOnTarget: { ...u.castsOnTarget } };
  return out;
}

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

export function hasState(fighter: Fighter, state: string): boolean {
  return fighter.buffs.some((b) => b.kind === 'state' && b.state === state);
}

/** Total shield HP left on a fighter. */
export function shieldOf(fighter: Fighter): number {
  return fighter.buffs.reduce((sum, b) => (b.kind === 'shield' ? sum + b.value : sum), 0);
}

/** A fighter's stats with every current buff and debuff applied. */
export function effectiveStats(fighter: Fighter): FighterStats {
  const s = fighter.stats;
  const out: FighterStats = {
    ...s,
    damage: { ...s.damage },
    resistPercent: { ...s.resistPercent },
    resistFlat: { ...s.resistFlat },
  };
  for (const b of fighter.buffs) {
    if (b.kind === 'stat') {
      out[b.stat] += b.value;
    } else if (b.kind === 'elementStat') {
      for (const e of b.element === 'all' ? ELEMENTS : [b.element]) out[b.stat][e] += b.value;
    }
  }
  return out;
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
  return Math.floor((total * fighter.hp) / s.maxHp);
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

/**
 * Cells a fighter can reach with its remaining MP, mapped to their MP cost.
 * Fighters block movement. Tackle is not counted: this is what the fighter
 * could reach if nobody tackled it.
 */
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
