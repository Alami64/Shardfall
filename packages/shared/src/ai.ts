/**
 * Monster AI by utility scoring (design doc, Monster AI). Each step it looks at
 * every cell it can reach this turn (moving there through the real engine, so
 * tackle counts), every spell it can cast from there and every useful target,
 * plays each option out with average rolls, and scores the result by its
 * archetype. The best few options also get the value of the best cast that
 * could follow from the same cell, so a buff that makes the next hit stronger
 * is cast first. It casts the best option while one is worth anything, then
 * spends what MP it has left on its position, then ends its turn.
 *
 * Planning never changes the state: options are tried with the same pure
 * actions the player uses. Only playAiTurn rolls real dice, with the Rng given.
 */
import { neighbors, distance } from './grid.js';
import { hasLineOfSight } from './lineOfSight.js';
import { blocksLineOfSight, isWalkable } from './map.js';
import { findPath } from './pathfinding.js';
import { castError, castSpell, endTurn, moveFighter, spellError } from './fight.js';
import {
  activeFighter,
  effectiveStats,
  fighterAt,
  getFighter,
  movementRange,
  type FightEvent,
  type FightResult,
  type FightState,
  type Fighter,
} from './fightState.js';
import type { AiProfile, Archetype } from './monster.js';
import type { Rng } from './rng.js';

export type AiAction =
  | { type: 'move'; path: number[] }
  | { type: 'cast'; spellId: string; cell: number }
  | { type: 'endTurn' };

/** How much each outcome is worth to an archetype. HP-based terms are per HP; position terms per cell or per enemy. */
export interface AiWeights {
  damage: number;
  kill: number;
  heal: number;
  shield: number;
  /** AP/MP removed from enemies, buffs on allies, debuffs and states on enemies. */
  control: number;
  friendlyFire: number;
  /** Per cell away from the preferred range to the nearest enemy. */
  position: number;
  /** When the nearest enemy is out of line of sight. */
  sight: number;
  /** Per enemy that could walk up and hit the fighter next turn. */
  danger: number;
}

const SHARED_WEIGHTS = { damage: 1, kill: 40, heal: 1, shield: 0.5, control: 4, friendlyFire: 1.5, position: 3 };

export const ARCHETYPE_WEIGHTS: Record<Archetype, AiWeights> = {
  // Closes distance and hits hard; never weighs its own safety.
  brute: { ...SHARED_WEIGHTS, sight: 0, danger: 0 },
  // Keeps its range and a clear shot, and stays out of reach when it can.
  caster: { ...SHARED_WEIGHTS, sight: 6, danger: 4 },
};

/** Used for fighters with no profile: walk up and hit. */
const DEFAULT_PROFILE: AiProfile = { archetype: 'brute', preferredRange: 1 };

/** Middle of every roll, no critical hit, removals that succeed when likelier than not: the expected outcome. */
const EXPECTED: Rng = () => 0.5;

/** A winning cast is worth more than anything else on the board. */
const WIN = 1000;

/** How many of the best casts get a second look for a follow-up cast. */
const LOOKAHEAD = 6;

const profileOf = (f: Fighter): AiProfile => f.ai ?? DEFAULT_PROFILE;

const enemiesOf = (state: FightState, f: Fighter) =>
  state.fighters.filter((o) => o.status === 'alive' && o.team !== f.team);

/** How good it is for `id` to stand where it stands in `state`, before anything else happens. */
function positionValue(state: FightState, id: string, profile: AiProfile, w: AiWeights): number {
  const f = getFighter(state, id);
  if (!f || f.status !== 'alive') return 0;
  const enemies = enemiesOf(state, f);
  if (enemies.length === 0) return 0;
  const nearest = enemies.reduce((a, b) => (distance(f.cell, b.cell) < distance(f.cell, a.cell) ? b : a));
  let value = -w.position * Math.abs(distance(f.cell, nearest.cell) - profile.preferredRange);
  if (w.sight > 0) {
    const blocks = (c: number) => blocksLineOfSight(state.map, c) || fighterAt(state, c) !== undefined;
    if (!hasLineOfSight(f.cell, nearest.cell, blocks)) value -= w.sight;
  }
  if (w.danger > 0) {
    // An enemy is a threat if it can walk next to this cell with its MP.
    const threats = enemies.filter((e) => distance(f.cell, e.cell) <= Math.max(0, effectiveStats(e).mp) + 1);
    value -= w.danger * threats.length;
  }
  return value;
}

/** What a cast's events are worth to `me`'s team. */
function outcomeValue(before: FightState, events: FightEvent[], me: Fighter, w: AiWeights): number {
  const ally = (id: string) => getFighter(before, id)?.team === me.team;
  let value = 0;
  for (const e of events) {
    switch (e.type) {
      case 'damaged':
        value += ally(e.fighterId) ? -w.friendlyFire * e.amount : w.damage * e.amount;
        break;
      case 'died':
        value += ally(e.fighterId) ? -2 * w.kill : w.kill;
        break;
      case 'revived':
        value += ally(e.fighterId) ? w.kill : -w.kill;
        break;
      case 'healed':
        value += (ally(e.fighterId) ? 1 : -1) * w.heal * e.amount;
        break;
      case 'pointsRemoved':
        value += (ally(e.fighterId) ? -1 : 1) * w.control * e.removed;
        break;
      case 'pointsChanged':
        value += (ally(e.fighterId) ? 1 : -1) * w.control * e.amount;
        break;
      case 'buffAdded': {
        const b = e.buff;
        // Shields and stat bonuses help allies; states and stat maluses hinder enemies.
        const good = b.kind === 'shield' || ((b.kind === 'stat' || b.kind === 'elementStat') && b.value > 0);
        const helps = ally(e.fighterId) === good;
        value += (helps ? 1 : -1) * (b.kind === 'shield' ? w.shield * b.value : w.control);
        break;
      }
      case 'fightEnded':
        value += e.winner === me.team ? WIN : -WIN;
        break;
    }
  }
  return value;
}

/** Cells worth aiming at: every fighter, the cells next to them (areas, free-cell spells) and the caster's own. */
function candidateTargets(state: FightState, me: Fighter): number[] {
  const cells = new Set<number>([me.cell]);
  for (const f of state.fighters) {
    if (f.status !== 'alive') continue;
    cells.add(f.cell);
    for (const n of neighbors(f.cell)) cells.add(n);
  }
  return [...cells].sort((a, b) => a - b);
}

/** Every cast the fighter can make from where it stands, with what it is worth and the state after it. */
function castOptions(state: FightState, me: Fighter, w: AiWeights) {
  const out: { spellId: string; cell: number; value: number; after: FightState }[] = [];
  for (const { spellId } of me.spells) {
    if (spellError(state, me.id, spellId)) continue;
    for (const cell of candidateTargets(state, me)) {
      if (castError(state, me.id, spellId, cell)) continue;
      const r = castSpell(state, me.id, spellId, cell, EXPECTED);
      if (!r.ok) continue;
      const value = outcomeValue(state, r.events, me, w);
      if (value > 0) out.push({ spellId, cell, value, after: r.state });
    }
  }
  return out;
}

/** The value of the best single cast the fighter could still make from where it stands. */
function bestFollowUp(state: FightState, id: string, w: AiWeights): number {
  const me = getFighter(state, id);
  if (!me || state.phase !== 'fighting' || activeFighter(state) !== me) return 0;
  return castOptions(state, me, w).reduce((best, o) => Math.max(best, o.value), 0);
}

/** Every cell the fighter can end up on this step, with the path there and the state after moving (tackle included). */
function origins(state: FightState, id: string): { path: number[]; state: FightState }[] {
  const f = getFighter(state, id)!;
  const byCell = new Map<number, { path: number[]; state: FightState }>([[f.cell, { path: [], state }]]);
  const walkable = (c: number) => isWalkable(state.map, c);
  const occupied = (c: number) => fighterAt(state, c) !== undefined;
  const reach = [...movementRange(state, id).keys()].sort((a, b) => a - b);
  for (const cell of reach) {
    const path = findPath(f.cell, cell, walkable, { isBlocked: occupied, maxSteps: f.mp });
    if (!path || path.length === 0) continue;
    const r = moveFighter(state, id, path);
    if (!r.ok) continue;
    // Tackle can stop the walk short: key by where the fighter really ends up.
    const end = getFighter(r.state, id)!.cell;
    const known = byCell.get(end);
    if (!known || path.length < known.path.length) byCell.set(end, { path, state: r.state });
  }
  return [...byCell.values()];
}

/**
 * The AI's next actions for the fighter whose turn it is: a cast (after a move
 * if that helps), else a move to a better position, else ending the turn.
 */
export function planAiStep(state: FightState, fighterId: string): AiAction[] {
  const me = getFighter(state, fighterId);
  if (!me || activeFighter(state) !== me) return [{ type: 'endTurn' }];
  const profile = profileOf(me);
  const w = ARCHETYPE_WEIGHTS[profile.archetype];

  const casts: { score: number; actions: AiAction[]; after: FightState }[] = [];
  let bestMove: { score: number; actions: AiAction[] } | null = null;
  const stay = positionValue(state, fighterId, profile, w);

  for (const origin of origins(state, fighterId)) {
    const moved = origin.state;
    const self = getFighter(moved, fighterId)!;
    const move: AiAction[] = origin.path.length ? [{ type: 'move', path: origin.path }] : [];

    if (origin.path.length) {
      const score = positionValue(moved, fighterId, profile, w);
      if (score > stay && (!bestMove || score > bestMove.score)) bestMove = { score, actions: move };
    }

    for (const o of castOptions(moved, self, w)) {
      const score = o.value + positionValue(o.after, fighterId, profile, w);
      casts.push({ score, actions: [...move, { type: 'cast', spellId: o.spellId, cell: o.cell }], after: o.after });
    }
  }

  // Stable sort: among equal scores the first found (closest cell, lowest ids) stays first.
  casts.sort((a, b) => b.score - a.score);
  let bestCast: (typeof casts)[number] | undefined;
  let bestTotal = -Infinity;
  for (const c of casts.slice(0, LOOKAHEAD)) {
    const total = c.score + bestFollowUp(c.after, fighterId, w);
    if (total > bestTotal) {
      bestTotal = total;
      bestCast = c;
    }
  }
  return bestCast?.actions ?? bestMove?.actions ?? [{ type: 'endTurn' }];
}

/**
 * Plays the active fighter's whole turn with the AI and ends it. Returns the
 * state after the turn and every event, like any other action.
 */
export function playAiTurn(state: FightState, fighterId: string, rng: Rng): FightResult {
  if (state.phase !== 'fighting') return { ok: false, error: 'wrong-phase' };
  if (activeFighter(state)?.id !== fighterId) return { ok: false, error: 'not-your-turn' };
  const events: FightEvent[] = [];
  let current = state;
  const ours = () => current.phase === 'fighting' && activeFighter(current)?.id === fighterId;

  for (let step = 0; step < 30 && ours(); step++) {
    const actions = planAiStep(current, fighterId);
    let progressed = false;
    for (const action of actions) {
      if (!ours() || action.type === 'endTurn') break;
      const r =
        action.type === 'move'
          ? moveFighter(current, fighterId, action.path)
          : castSpell(current, fighterId, action.spellId, action.cell, rng);
      if (!r.ok) break;
      current = r.state;
      events.push(...r.events);
      progressed = true;
    }
    if (!progressed) break;
  }
  if (ours()) {
    const r = endTurn(current, fighterId);
    if (r.ok) {
      current = r.state;
      events.push(...r.events);
    }
  }
  return { ok: true, state: current, events };
}
