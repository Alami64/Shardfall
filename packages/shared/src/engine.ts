/**
 * The fight engine's internals. Every function here edits a state in place, so
 * it must only ever see a copy made by cloneFight inside an action (fight.ts).
 * Not exported from the package.
 */
import { cellToGrid, gridToCell, neighbors, type GridPos } from './grid.js';
import { isWalkable } from './map.js';
import {
  activeFighter,
  effectiveStats,
  fighterAt,
  getFighter,
  hasState,
  STATE_ROOTED,
  TEAMS,
  EROSION_RATE,
  type Buff,
  type BuffKind,
  type DisplacementReason,
  type Fighter,
  type FightEvent,
  type FightState,
} from './fightState.js';
import {
  STEAL_RATE,
  directDamage,
  healAmount,
  pointsAfterTackle,
  pushbackDamage,
  removalChance,
  resistedDamage,
  tackleEscape,
} from './formulas.js';
import { randomInt, type Rng } from './rng.js';
import type { Effect, Spell, SpellGrade } from './spell.js';
import { isElementStat, isScalarStat } from './stats.js';
import { castDirection, zoneCells } from './zone.js';

// ---------------------------------------------------------------------------
// Turns and the end of the fight

/**
 * Starts the active fighter's turn: buffs it cast count down (and expire at 0),
 * then AP and MP refill with buffs counted, and per-turn cast counts reset.
 */
export function beginTurn(state: FightState, events: FightEvent[]): void {
  const f = activeFighter(state)!;
  events.push({ type: 'turnStarted', fighterId: f.id, round: state.round });
  tickBuffs(state, f.id, events);
  const stats = effectiveStats(f);
  f.ap = Math.max(0, stats.ap);
  f.mp = Math.max(0, stats.mp);
  f.turns++;
  for (const usage of Object.values(f.spellUsage)) {
    usage.castsThisTurn = 0;
    usage.castsOnTarget = {};
  }
}

/** Closes the active fighter's turn (unused points are lost) and starts the next living fighter's. */
export function passTurn(state: FightState, events: FightEvent[]): void {
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

const standingTeams = (state: FightState) =>
  TEAMS.filter((t) => state.fighters.some((f) => f.team === t && f.status === 'alive'));

/** Ends the fight once a team has nobody left standing. Returns true when it ended. */
function checkEnd(state: FightState, events: FightEvent[]): boolean {
  const standing = standingTeams(state);
  if (standing.length === TEAMS.length) return false;
  state.phase = 'ended';
  state.winner = standing[0] ?? null;
  events.push({ type: 'fightEnded', winner: state.winner });
  return true;
}

/**
 * Runs at the end of every action: ends the fight if a team is out, otherwise
 * passes the turn if the active fighter left the board.
 */
export function settle(state: FightState, events: FightEvent[]): void {
  if (state.phase !== 'fighting' || checkEnd(state, events)) return;
  if (activeFighter(state)?.status !== 'alive') passTurn(state, events);
}

/** Takes a fighter off the board. Its buffs, and the buffs it cast on others, end without events. */
export function leaveBoard(state: FightState, f: Fighter, status: 'dead' | 'fled'): void {
  f.status = status;
  f.cell = -1;
  f.buffs = [];
  for (const other of state.fighters) other.buffs = other.buffs.filter((b) => b.casterId !== f.id);
}

// ---------------------------------------------------------------------------
// HP

/**
 * Takes `amount` HP (already after resistances). Shields absorb first, oldest
 * first; erosion takes 10% of the HP actually lost off max HP. At 0 HP the
 * fighter dies. Returns the HP lost.
 */
export function hurt(state: FightState, f: Fighter, amount: number, events: FightEvent[]): number {
  let left = Math.max(0, Math.floor(amount));
  for (const b of f.buffs) {
    if (b.kind !== 'shield' || left === 0) continue;
    const absorbed = Math.min(b.value, left);
    b.value -= absorbed;
    left -= absorbed;
    events.push({ type: 'shieldHit', fighterId: f.id, absorbed, remaining: b.value });
  }
  f.buffs = f.buffs.filter((b) => b.kind !== 'shield' || b.value > 0);

  const lost = Math.min(f.hp, left);
  const erosion = Math.floor(lost * EROSION_RATE);
  f.hp -= lost;
  f.maxHp -= erosion;
  events.push({ type: 'damaged', fighterId: f.id, amount: lost, erosion, hp: f.hp });
  if (f.hp === 0) {
    events.push({ type: 'died', fighterId: f.id, cell: f.cell });
    leaveBoard(state, f, 'dead');
  }
  return lost;
}

/** Restores HP up to the (eroded) max. */
function heal(f: Fighter, amount: number, events: FightEvent[]): void {
  const healed = Math.min(f.maxHp - f.hp, Math.max(0, amount));
  f.hp += healed;
  events.push({ type: 'healed', fighterId: f.id, amount: healed, hp: f.hp });
}

// ---------------------------------------------------------------------------
// Buffs

/**
 * Adds a buff. An AP or MP change on the fighter whose turn it is also applies
 * to its points right away, so +2 AP during your own turn is usable at once.
 */
function addBuff(state: FightState, f: Fighter, buff: Buff, events: FightEvent[]): void {
  f.buffs.push(buff);
  events.push({ type: 'buffAdded', fighterId: f.id, buff: { ...buff } });
  if (buff.kind === 'stat' && (buff.stat === 'ap' || buff.stat === 'mp') && activeFighter(state) === f) {
    changePoints(f, buff.stat, buff.value, events);
  }
}

function changePoints(f: Fighter, points: 'ap' | 'mp', amount: number, events: FightEvent[]): void {
  const before = f[points];
  f[points] = Math.max(0, before + amount);
  events.push({ type: 'pointsChanged', fighterId: f.id, points, amount: f[points] - before });
}

/** Counts down every buff `casterId` cast, on every fighter, and removes those that reach 0. */
function tickBuffs(state: FightState, casterId: string, events: FightEvent[]): void {
  for (const f of state.fighters) {
    const kept: Buff[] = [];
    for (const b of f.buffs) {
      if (b.casterId === casterId) b.remaining--;
      if (b.remaining > 0) kept.push(b);
      else events.push({ type: 'buffExpired', fighterId: f.id, buff: { ...b } });
    }
    f.buffs = kept;
  }
}

// ---------------------------------------------------------------------------
// Movement

/**
 * Tackle on leaving the fighter's cell: when enemies stand next to it, it keeps
 * the escape share of its MP and AP, rounded down.
 */
export function applyTackle(state: FightState, f: Fighter, events: FightEvent[]): void {
  let lock = 0;
  let enemies = 0;
  for (const c of neighbors(f.cell)) {
    const other = fighterAt(state, c);
    if (other && other.team !== f.team) {
      lock += effectiveStats(other).lock;
      enemies++;
    }
  }
  if (enemies === 0) return;
  const escape = tackleEscape(effectiveStats(f).dodge, lock);
  const mp = pointsAfterTackle(f.mp, escape);
  const ap = pointsAfterTackle(f.ap, escape);
  if (mp === f.mp && ap === f.ap) return;
  events.push({ type: 'tackled', fighterId: f.id, cell: f.cell, apLost: f.ap - ap, mpLost: f.mp - mp });
  f.mp = mp;
  f.ap = ap;
}

const isFree = (state: FightState, cell: number) =>
  cell !== -1 && isWalkable(state.map, cell) && fighterAt(state, cell) === undefined;

/** Slides a fighter up to `cells` steps in `dir`; returns the cells it travelled through. */
function slide(state: FightState, f: Fighter, dir: GridPos, cells: number): number[] {
  const path: number[] = [];
  let { x, y } = cellToGrid(f.cell);
  for (let k = 0; k < cells; k++) {
    const next = gridToCell(x + dir.x, y + dir.y);
    if (!isFree(state, next)) break;
    path.push(next);
    x += dir.x;
    y += dir.y;
  }
  if (path.length) f.cell = path[path.length - 1]!;
  return path;
}

function displaced(f: Fighter, path: number[], reason: DisplacementReason, events: FightEvent[]): void {
  if (path.length) events.push({ type: 'displaced', fighterId: f.id, path, reason });
}

// ---------------------------------------------------------------------------
// Spells

const roll = (rng: Rng, e: Effect) => randomInt(rng, e.min ?? 0, e.max ?? e.min ?? 0);

/** Fighters in an effect's area that it applies to, in area order. */
function effectTargets(state: FightState, caster: Fighter, e: Effect, center: number): Fighter[] {
  const out: Fighter[] = [];
  for (const c of zoneCells(e.zone, center, caster.cell)) {
    const f = fighterAt(state, c);
    if (!f) continue;
    const role = f === caster ? 'self' : f.team === caster.team ? 'allies' : 'enemies';
    if (!e.targets.includes(role)) continue;
    if (e.requiresState && !hasState(f, e.requiresState)) continue;
    if (e.forbidsState && hasState(f, e.forbidsState)) continue;
    out.push(f);
  }
  return out;
}

/** Rolls the critical hit, then applies the grade's effects (or critical effects) in order. */
export function resolveSpell(
  state: FightState,
  caster: Fighter,
  spell: Spell,
  grade: SpellGrade,
  gradeNumber: number,
  cell: number,
  rng: Rng,
  events: FightEvent[],
): void {
  let critical = false;
  if (grade.criticalEffects.length > 0) {
    const chance = grade.criticalChance + effectiveStats(caster).criticalChance;
    critical = rng() * 100 < chance;
  }
  events.push({ type: 'spellCast', fighterId: caster.id, spellId: spell.id, grade: gradeNumber, cell, critical });

  for (const effect of critical ? grade.criticalEffects : grade.effects) {
    if (state.phase !== 'fighting' || caster.status !== 'alive') break;
    applyEffect(state, caster, spell.id, effect, cell, critical, rng, events);
    if (standingTeams(state).length < TEAMS.length) break; // the fight is over: later effects do not run
  }
}

function applyEffect(
  state: FightState,
  caster: Fighter,
  spellId: string,
  e: Effect,
  cell: number,
  critical: boolean,
  rng: Rng,
  events: FightEvent[],
): void {
  const duration = e.duration ?? 0;
  switch (e.kind) {
    case 'damage':
    case 'steal': {
      const element = e.element ?? 'neutral';
      const dmg = directDamage(roll(rng, e), effectiveStats(caster), element, critical);
      for (const t of effectTargets(state, caster, e, cell)) {
        if (t.status !== 'alive') continue;
        const final = resistedDamage(dmg, effectiveStats(t), element, t.controller === 'player');
        const lost = hurt(state, t, final, events);
        if (e.kind === 'steal' && caster.status === 'alive') heal(caster, Math.floor(lost * STEAL_RATE), events);
      }
      return;
    }
    case 'heal': {
      const amount = healAmount(roll(rng, e), effectiveStats(caster));
      for (const t of effectTargets(state, caster, e, cell)) heal(t, amount, events);
      return;
    }
    case 'shield': {
      const percent = Number(e.params?.maxHpPercent ?? 0);
      const rolled = percent > 0 ? 0 : roll(rng, e);
      for (const t of effectTargets(state, caster, e, cell)) {
        const value = percent > 0 ? Math.floor((t.maxHp * percent) / 100) : rolled;
        if (value <= 0) continue;
        const buff: Buff = { kind: 'shield', casterId: caster.id, spellId, value, remaining: Math.max(1, duration) };
        addBuff(state, t, buff, events);
      }
      return;
    }
    case 'buff':
    case 'debuff': {
      const kind = buffKind(e);
      if (!kind) return;
      const value = roll(rng, e) * (e.kind === 'debuff' ? -1 : 1);
      for (const t of effectTargets(state, caster, e, cell)) {
        if (duration > 0) {
          addBuff(state, t, { ...kind, casterId: caster.id, spellId, value, remaining: duration }, events);
        } else if (kind.kind === 'stat' && (kind.stat === 'ap' || kind.stat === 'mp')) {
          changePoints(t, kind.stat, value, events); // instant: only the points this turn
        }
      }
      return;
    }
    case 'state': {
      const name = e.params?.state;
      if (typeof name !== 'string') return;
      for (const t of effectTargets(state, caster, e, cell)) {
        const remaining = Math.max(1, duration);
        const buff: Buff = { kind: 'state', state: name, casterId: caster.id, spellId, value: 0, remaining };
        addBuff(state, t, buff, events);
      }
      return;
    }
    case 'push':
    case 'pull': {
      const cells = Number(e.params?.cells ?? 0);
      for (const t of effectTargets(state, caster, e, cell)) {
        if (t.status !== 'alive' || t === caster || hasState(t, STATE_ROOTED)) continue;
        const away = castDirection(caster.cell, t.cell);
        const dir = e.kind === 'push' ? away : { x: -away.x, y: -away.y };
        const path = slide(state, t, dir, cells);
        displaced(t, path, e.kind, events);
        const blocked = cells - path.length;
        if (e.kind === 'push' && blocked > 0) {
          const s = effectiveStats(caster);
          hurt(state, t, pushbackDamage(s.level, s.pushbackDamage, blocked), events);
        }
      }
      return;
    }
    case 'removeAP':
    case 'removeMP': {
      const points = e.kind === 'removeAP' ? 'ap' : 'mp';
      const amount = roll(rng, e);
      for (const t of effectTargets(state, caster, e, cell)) {
        removePoints(state, caster, spellId, t, points, amount, Math.max(1, duration), rng, events);
      }
      return;
    }
    case 'teleport': {
      if (!isFree(state, cell)) return;
      caster.cell = cell;
      displaced(caster, [cell], 'teleport', events);
      return;
    }
    case 'swap': {
      const other = fighterAt(state, cell);
      if (!other || other === caster || hasState(other, STATE_ROOTED) || hasState(caster, STATE_ROOTED)) return;
      [caster.cell, other.cell] = [other.cell, caster.cell];
      displaced(caster, [caster.cell], 'swap', events);
      displaced(other, [other.cell], 'swap', events);
      return;
    }
    case 'summon':
    case 'glyph':
    case 'trap':
      // Not supported yet; the content validator rejects them.
      return;
  }
}

/** The stat a buff or debuff effect changes, from params.stat and, for per-element stats, its element (none = all). */
function buffKind(e: Effect): BuffKind | null {
  const stat = e.params?.stat;
  if (typeof stat !== 'string') return null;
  if (isScalarStat(stat)) return { kind: 'stat', stat };
  if (isElementStat(stat)) return { kind: 'elementStat', stat, element: e.element ?? 'all' };
  return null;
}

/**
 * AP or MP removal: each point is rolled against removalChance. On the target's
 * own turn the points come off what it has left; otherwise they come off its
 * next turn, as a debuff lasting `duration` of the caster's turns.
 */
function removePoints(
  state: FightState,
  caster: Fighter,
  spellId: string,
  t: Fighter,
  points: 'ap' | 'mp',
  amount: number,
  duration: number,
  rng: Rng,
  events: FightEvent[],
): void {
  const ownTurn = activeFighter(state) === t;
  const casterStats = effectiveStats(caster);
  const targetStats = effectiveStats(t);
  const removal = points === 'ap' ? casterStats.apRemoval : casterStats.mpRemoval;
  const parry = points === 'ap' ? targetStats.apParry : targetStats.mpParry;
  const max = t.stats[points];
  let current = ownTurn ? t[points] : Math.max(0, targetStats[points]);
  let removed = 0;
  let dodged = 0;
  for (let i = 0; i < amount && current > 0; i++) {
    if (rng() < removalChance(removal, parry, current, max)) {
      removed++;
      current--;
    } else {
      dodged++;
    }
  }
  events.push({ type: 'pointsRemoved', fighterId: t.id, points, removed, dodged });
  if (removed === 0) return;
  if (ownTurn) {
    t[points] -= removed;
  } else {
    const value = -removed;
    const buff: Buff = { kind: 'stat', stat: points, casterId: caster.id, spellId, value, remaining: duration };
    addBuff(state, t, buff, events);
  }
}
