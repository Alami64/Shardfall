// Fight rules: state, actions (move, cast, end turn), effects and monster AI.
// Pure logic: no rendering, randomness comes from the Rng passed in.
import { areaCells, dist, fromUV, inLine, neighbors, stepAway, uv } from './grid.js';
import { findPath, hasLos, reachable } from './path.js';
import { rint, type Rng } from './rng.js';
import { rankMult, SPELLS, type Effect, type Element, type SpellDef } from './content.js';

export interface Buff {
  name: string;
  stat: 'ap' | 'mp' | 'power' | 'shield' | 'poison';
  value: number;
  turns: number;
  el?: Element;
}

export interface SpellSlot { id: string; rank: number; cd: number; used: number }

export interface Fighter {
  id: number;
  team: 0 | 1;
  name: string;
  /** 'player' or a monster id. */
  kind: string;
  level: number;
  cell: number;
  hp: number;
  maxHp: number;
  ap: number;
  mp: number;
  baseAp: number;
  baseMp: number;
  str: number;
  int: number;
  agi: number;
  luck: number;
  power: number;
  dmg: number;
  crit: number;
  init: number;
  res: Record<Element, number>;
  spells: SpellSlot[];
  buffs: Buff[];
  alive: boolean;
  ai: 'melee' | 'ranged' | 'support';
}

export interface FightState {
  fighters: Fighter[];
  order: number[];
  idx: number;
  round: number;
  walkable: boolean[];
  opaque: boolean[];
  /** Spells that exist only in this fight (the player's weapon attack). */
  extraSpells: Record<string, SpellDef>;
  over: null | 'win' | 'lose';
}

export type FEvent =
  | { t: 'turn'; id: number }
  | { t: 'move'; id: number; path: number[] }
  | { t: 'cast'; id: number; spell: string; name: string; color: string; cell: number; cells: number[]; crit: boolean }
  | { t: 'dmg'; id: number; n: number; el: Element; hp: number; crit?: boolean }
  | { t: 'heal'; id: number; n: number; hp: number }
  | { t: 'death'; id: number }
  | { t: 'buff'; id: number; text: string; good: boolean }
  | { t: 'slide'; id: number; to: number }
  | { t: 'tp'; id: number; to: number }
  | { t: 'log'; text: string }
  | { t: 'end'; result: 'win' | 'lose' };

// ------------------------------------------------------------ queries

export const spellOf = (st: FightState, id: string): SpellDef => st.extraSpells[id] ?? SPELLS[id]!;
export const current = (st: FightState): Fighter => st.fighters[st.order[st.idx]!]!;
export const fighterAt = (st: FightState, cell: number): Fighter | undefined =>
  st.fighters.find((f) => f.alive && f.cell === cell);
export const living = (st: FightState, team?: number): Fighter[] =>
  st.fighters.filter((f) => f.alive && (team === undefined || f.team === team));
export const free = (st: FightState, cell: number) => !!st.walkable[cell] && !fighterAt(st, cell);
const sumBuff = (f: Fighter, stat: Buff['stat']) => f.buffs.reduce((n, b) => (b.stat === stat ? n + b.value : n), 0);
export const powerOf = (f: Fighter) => f.power + sumBuff(f, 'power');

const elementStat = (f: Fighter, el: Element) => (el === 'physical' ? f.str : el === 'fire' ? f.int : f.agi);
export const isHostile = (s: SpellDef) =>
  s.effects.some((e) => e.k === 'damage' || e.k === 'poison' || e.k === 'push' || (e.k === 'buff' && e.to === 'enemies'));

/** Damage range of an effect for display, with the caster's stats applied. */
export function damageRange(f: Fighter, e: { el: Element; min: number; max: number }, rank: number): [number, number] {
  const m = (rankMult(rank) * (100 + elementStat(f, e.el) + powerOf(f))) / 100;
  return [Math.floor(e.min * m) + f.dmg, Math.floor(e.max * m) + f.dmg];
}
export function healRange(f: Fighter, e: { min: number; max: number }, rank: number): [number, number] {
  const m = (rankMult(rank) * (100 + f.int)) / 100;
  return [Math.floor(e.min * m), Math.floor(e.max * m)];
}

/** Chance (0..1) that a fighter slips away from one adjacent enemy. */
export const dodgeChance = (mover: Fighter, blocker: Fighter) =>
  Math.max(0.1, Math.min(1, (mover.agi + 40) / (mover.agi + blocker.agi + 50)));
export const lockers = (st: FightState, f: Fighter, cell = f.cell) =>
  st.fighters.filter((o) => o.alive && o.team !== f.team && dist(o.cell, cell) === 1);

/** Why a spell cannot be cast on a cell, or null when it can. */
export function castError(st: FightState, f: Fighter, spellId: string, cell: number, from = f.cell): string | null {
  const slot = f.spells.find((s) => s.id === spellId);
  if (!slot) return 'Unknown spell';
  const sp = spellOf(st, spellId);
  if (f.ap < sp.ap) return 'Not enough AP';
  if (slot.cd > 0) return `Ready in ${slot.cd} turn${slot.cd > 1 ? 's' : ''}`;
  if (sp.perTurn && slot.used >= sp.perTurn) return 'No more casts this turn';
  if (cell < 0) return 'Out of the map';
  const d = dist(from, cell);
  if (d < sp.range[0] || d > sp.range[1]) return 'Out of range';
  if (sp.line && !inLine(from, cell)) return 'Must be cast in a straight line';
  const tgt = st.fighters.find((o) => o.alive && o.id !== f.id && o.cell === cell) ?? (cell === from ? f : undefined);
  if (sp.target === 'self' && cell !== from) return 'Cast on yourself';
  if (sp.target === 'empty' && (!st.walkable[cell] || tgt)) return 'Needs a free cell';
  if (sp.target === 'fighter') {
    if (!tgt) return 'Needs a target';
    if (isHostile(sp) ? tgt.team === f.team : tgt.team !== f.team) return 'Wrong target';
  }
  if (sp.los && d > 1) {
    const blocks = (i: number) => !!st.opaque[i] || st.fighters.some((o) => o.alive && o.id !== f.id && o.cell === i);
    if (!hasLos(from, cell, blocks)) return 'No line of sight';
  }
  return null;
}

/** Cells in range of a spell, split by whether the cast is possible. */
export function spellCells(st: FightState, f: Fighter, spellId: string): { ok: number[]; blocked: number[] } {
  const sp = spellOf(st, spellId);
  const ok: number[] = [], blocked: number[] = [];
  const [u, v] = uv(f.cell);
  const R = sp.range[1];
  for (let du = -R; du <= R; du++) {
    for (let dv = -R; dv <= R; dv++) {
      const d = Math.abs(du) + Math.abs(dv);
      if (d < sp.range[0] || d > R) continue;
      if (sp.line && du !== 0 && dv !== 0) continue;
      const c = fromUV(u + du, v + dv);
      if (c < 0 || (!st.walkable[c] && sp.target !== 'cell')) continue;
      if (sp.target === 'cell' && st.opaque[c]) continue;
      const err = castError(st, f, spellId, c);
      if (!err) ok.push(c);
      else if (err === 'No line of sight' || err === 'Needs a target' || err === 'Wrong target' || err === 'Needs a free cell') blocked.push(c);
    }
  }
  return { ok, blocked };
}

export const spellArea = (sp: SpellDef, cell: number) => (sp.area ? areaCells(cell, sp.area.shape, sp.area.size) : [cell]);

export function moveCells(st: FightState, f: Fighter): Map<number, number[]> {
  return reachable(f.cell, f.mp, (i) => free(st, i));
}

// ------------------------------------------------------------ set-up

export function createFight(
  fighters: Fighter[],
  walkable: boolean[],
  opaque: boolean[],
  extraSpells: Record<string, SpellDef> = {},
): FightState {
  fighters.forEach((f, i) => (f.id = i));
  const order = fighters.map((f) => f.id).sort((a, b) => fighters[b]!.init - fighters[a]!.init || a - b);
  return { fighters, order, idx: 0, round: 1, walkable, opaque, extraSpells, over: null };
}

// ------------------------------------------------------------ engine

function checkOver(st: FightState, ev: FEvent[]) {
  if (st.over) return;
  if (living(st, 0).length === 0) st.over = 'lose';
  else if (living(st, 1).length === 0) st.over = 'win';
  if (st.over) ev.push({ t: 'end', result: st.over });
}

function hurt(st: FightState, tgt: Fighter, raw: number, el: Element, ev: FEvent[], crit = false): number {
  if (!tgt.alive) return 0;
  let n = Math.max(0, raw - sumBuff(tgt, 'shield'));
  n = Math.max(0, Math.floor((n * (100 - tgt.res[el])) / 100));
  n = Math.min(n, tgt.hp);
  tgt.hp -= n;
  ev.push({ t: 'dmg', id: tgt.id, n, el, hp: tgt.hp, crit });
  if (tgt.hp <= 0) {
    tgt.alive = false;
    tgt.buffs = [];
    ev.push({ t: 'death', id: tgt.id });
    checkOver(st, ev);
  }
  return n;
}

function mend(tgt: Fighter, n: number, ev: FEvent[]) {
  if (!tgt.alive) return;
  n = Math.min(n, tgt.maxHp - tgt.hp);
  tgt.hp += n;
  ev.push({ t: 'heal', id: tgt.id, n, hp: tgt.hp });
}

function addBuff(tgt: Fighter, b: Buff, ev: FEvent[], isTurnOf: boolean) {
  const old = tgt.buffs.find((o) => o.name === b.name);
  if (old) {
    old.turns = b.turns;
    old.value = b.value;
  } else {
    tgt.buffs.push(b);
    if (isTurnOf && b.stat === 'ap') tgt.ap = Math.max(0, tgt.ap + b.value);
    if (isTurnOf && b.stat === 'mp') tgt.mp = Math.max(0, tgt.mp + b.value);
  }
  const sign = b.value > 0 ? '+' : '';
  const text =
    b.stat === 'poison' ? b.name :
    b.stat === 'shield' ? `${b.name} (${b.value} shield)` :
    `${sign}${b.value} ${b.stat === 'power' ? 'power' : b.stat.toUpperCase()}`;
  ev.push({ t: 'buff', id: tgt.id, text, good: b.stat !== 'poison' && b.value > 0 });
}

function rawDamage(f: Fighter, e: { el: Element; min: number; max: number }, rank: number, crit: boolean, rng: Rng) {
  const base = crit ? Math.round(e.max * 1.3) : rint(rng, e.min, e.max);
  return Math.floor((base * rankMult(rank) * (100 + elementStat(f, e.el) + powerOf(f))) / 100) + f.dmg;
}

function applyEffect(st: FightState, f: Fighter, e: Effect, rank: number, cell: number, targets: Fighter[], crit: boolean, rng: Rng, ev: FEvent[]) {
  const foes = targets.filter((t) => t.team !== f.team);
  const friends = targets.filter((t) => t.team === f.team);
  const isTurn = (t: Fighter) => current(st).id === t.id;
  switch (e.k) {
    case 'damage':
      for (const t of foes) {
        const n = hurt(st, t, rawDamage(f, e, rank, crit, rng), e.el, ev, crit);
        if (e.steal && n > 0) mend(f, Math.floor(n / 2), ev);
      }
      break;
    case 'heal':
      for (const t of friends) {
        const base = crit ? Math.round(e.max * 1.3) : rint(rng, e.min, e.max);
        mend(t, Math.floor((base * rankMult(rank) * (100 + f.int)) / 100), ev);
      }
      break;
    case 'buff': {
      const list = e.to === 'self' ? [f] : e.to === 'enemies' ? foes : friends;
      for (const t of list) if (t.alive) addBuff(t, { name: e.name, stat: e.stat, value: e.value, turns: e.turns }, ev, isTurn(t));
      break;
    }
    case 'poison':
      for (const t of foes) {
        if (!t.alive) continue;
        const value = rawDamage(f, e, rank, false, rng);
        addBuff(t, { name: e.name, stat: 'poison', value, turns: e.turns, el: e.el }, ev, false);
      }
      break;
    case 'push':
      for (const t of foes) {
        if (!t.alive) continue;
        const [du, dv] = stepAway(f.cell, t.cell);
        let moved = 0;
        let [u, v] = uv(t.cell);
        while (moved < e.dist) {
          const n = fromUV(u + du, v + dv);
          if (n < 0 || !free(st, n)) break;
          t.cell = n;
          u += du;
          v += dv;
          moved++;
        }
        if (moved > 0) ev.push({ t: 'slide', id: t.id, to: t.cell });
        if (moved < e.dist) hurt(st, t, (e.dist - moved) * (4 + Math.floor(f.level / 3)), 'physical', ev);
      }
      break;
    case 'teleport':
      f.cell = cell;
      ev.push({ t: 'tp', id: f.id, to: cell });
      break;
  }
}

/** Cast a spell. Returns no events when the cast is not allowed. */
export function cast(st: FightState, f: Fighter, spellId: string, cell: number, rng: Rng): FEvent[] {
  if (st.over || castError(st, f, spellId, cell)) return [];
  const sp = spellOf(st, spellId);
  const slot = f.spells.find((s) => s.id === spellId)!;
  f.ap -= sp.ap;
  slot.used++;
  if (sp.cooldown) slot.cd = sp.cooldown;
  const cells = spellArea(sp, cell);
  const crit = rng() * 100 < f.crit && sp.effects.some((e) => e.k === 'damage' || e.k === 'heal');
  const ev: FEvent[] = [{ t: 'cast', id: f.id, spell: sp.id, name: sp.name, color: sp.color, cell, cells, crit }];
  const targets = st.fighters
    .filter((t) => t.alive && cells.includes(t.cell))
    .sort((a, b) => dist(a.cell, cell) - dist(b.cell, cell));
  for (const e of sp.effects) {
    if (st.over) break;
    applyEffect(st, f, e, slot.rank, cell, targets, crit, rng, ev);
  }
  return ev;
}

/** Walk along a path of adjacent free cells, as far as MP and enemy locks allow. */
export function move(st: FightState, f: Fighter, path: number[], rng: Rng): FEvent[] {
  const ev: FEvent[] = [];
  if (st.over) return ev;
  const walked: number[] = [];
  for (const next of path) {
    if (f.mp <= 0 || dist(f.cell, next) !== 1 || !free(st, next)) break;
    const held = lockers(st, f).find((o) => rng() > dodgeChance(f, o));
    if (held) {
      f.mp = 0;
      if (walked.length) ev.push({ t: 'move', id: f.id, path: [...walked] });
      walked.length = 0;
      ev.push({ t: 'log', text: `${f.name} is held in place by ${held.name}.` });
      ev.push({ t: 'buff', id: f.id, text: 'Locked', good: false });
      break;
    }
    f.cell = next;
    f.mp--;
    walked.push(next);
  }
  if (walked.length) ev.push({ t: 'move', id: f.id, path: walked });
  return ev;
}

function beginTurn(st: FightState, ev: FEvent[]) {
  const f = current(st);
  ev.push({ t: 'turn', id: f.id });
  for (const b of f.buffs) {
    if (b.stat === 'poison' && f.alive) {
      ev.push({ t: 'log', text: `${f.name} suffers from ${b.name}.` });
      hurt(st, f, b.value, b.el ?? 'physical', ev);
    }
  }
  f.ap = Math.max(0, f.baseAp + sumBuff(f, 'ap'));
  f.mp = Math.max(0, f.baseMp + sumBuff(f, 'mp'));
  for (const s of f.spells) {
    if (s.cd > 0) s.cd--;
    s.used = 0;
  }
}

/** Start the fight: the first fighter's turn begins. */
export function startFight(st: FightState): FEvent[] {
  const ev: FEvent[] = [];
  beginTurn(st, ev);
  if (!current(st).alive && !st.over) ev.push(...endTurn(st));
  return ev;
}

/** End the current turn and begin the next living fighter's turn. */
export function endTurn(st: FightState): FEvent[] {
  const ev: FEvent[] = [];
  if (st.over) return ev;
  const f = current(st);
  for (const b of f.buffs) b.turns--;
  f.buffs = f.buffs.filter((b) => b.turns > 0);
  for (let guard = 0; guard < st.order.length * 2 && !st.over; guard++) {
    st.idx = (st.idx + 1) % st.order.length;
    if (st.idx === 0) st.round++;
    if (!current(st).alive) continue;
    beginTurn(st, ev);
    if (current(st).alive) break;
  }
  return ev;
}

// ------------------------------------------------------------ AI

interface CastPlan { spell: string; cell: number; score: number }

const usable = (st: FightState, f: Fighter, s: SpellSlot) => {
  const sp = spellOf(st, s.id);
  return f.ap >= sp.ap && s.cd === 0 && !(sp.perTurn && s.used >= sp.perTurn) && !sp.effects.some((e) => e.k === 'teleport');
};

/** Rough value of casting a spell on a cell from a given standing cell. */
function scoreCast(st: FightState, f: Fighter, slot: SpellSlot, cell: number, from: number): number {
  const sp = spellOf(st, slot.id);
  const centre = sp.target === 'self' ? from : cell;
  const cells = spellArea(sp, centre);
  const targets = st.fighters.filter((t) => t.alive && (t.id === f.id ? cells.includes(from) : cells.includes(t.cell)));
  let score = 0;
  for (const e of sp.effects) {
    if (e.k === 'damage' || e.k === 'poison') {
      for (const t of targets) {
        if (t.team === f.team) continue;
        const [lo, hi] = damageRange(f, e, slot.rank);
        let n = ((lo + hi) / 2) * (1 - t.res[e.el] / 100) * (e.k === 'poison' ? e.turns * 0.8 : 1);
        n = Math.max(0, n - sumBuff(t, 'shield'));
        score += Math.min(n, t.hp) + (n >= t.hp ? 12 : 0);
        if (e.k === 'damage' && e.steal) score += Math.min(n / 2, f.maxHp - f.hp) * 0.8;
      }
    } else if (e.k === 'heal') {
      for (const t of targets) {
        if (t.team !== f.team) continue;
        const missing = t.maxHp - t.hp;
        if (missing < t.maxHp * 0.3) continue;
        const [lo, hi] = healRange(f, e, slot.rank);
        score += Math.min(missing, (lo + hi) / 2);
      }
    } else if (e.k === 'buff') {
      const list = e.to === 'self' ? [f] : targets.filter((t) => (e.to === 'enemies' ? t.team !== f.team : t.team === f.team));
      for (const t of list) if (!t.buffs.some((b) => b.name === e.name)) score += e.stat === 'power' ? 9 : e.stat === 'shield' ? 7 : 3;
    } else if (e.k === 'push') {
      score += 1;
    }
  }
  return score / Math.max(1, sp.ap) * 3 + score * 0.25;
}

function bestCast(st: FightState, f: Fighter, from: number): CastPlan | null {
  let best: CastPlan | null = null;
  for (const slot of f.spells) {
    const sp = spellOf(st, slot.id);
    if (!usable(st, f, slot)) continue;
    const cells = sp.target === 'self' ? [from] : st.fighters.filter((t) => t.alive).map((t) => (t.id === f.id ? from : t.cell));
    for (const c of cells) {
      // The caster's own cell is tested as the standing cell.
      if (castErrorFrom(st, f, slot.id, c, from)) continue;
      const score = scoreCast(st, f, slot, c, from);
      if (score > 0 && (!best || score > best.score)) best = { spell: slot.id, cell: c, score };
    }
  }
  return best;
}

/** castError for a caster imagined standing on another cell. */
function castErrorFrom(st: FightState, f: Fighter, spellId: string, cell: number, from: number): string | null {
  if (from === f.cell) return castError(st, f, spellId, cell);
  const real = f.cell;
  f.cell = from;
  const err = castError(st, f, spellId, cell);
  f.cell = real;
  return err;
}

type Plan = { t: 'cast'; spell: string; cell: number } | { t: 'move'; path: number[] } | null;

function planStep(st: FightState, f: Fighter, kited: boolean): Plan {
  const here = bestCast(st, f, f.cell);
  if (here) return { t: 'cast', spell: here.spell, cell: here.cell };
  const foes = living(st, f.team === 0 ? 1 : 0);
  if (!foes.length || f.mp <= 0) return null;
  const nearest = (c: number) => Math.min(...foes.map((o) => dist(o.cell, c)));
  const reach = moveCells(st, f);

  // A cell from which something can be cast.
  let bestCell = -1, bestScore = 0;
  for (const [c, path] of reach) {
    const plan = bestCast(st, f, c);
    if (!plan) continue;
    const tie = f.ai === 'melee' ? -path.length * 0.01 : nearest(c) * 0.05 - path.length * 0.01;
    const score = plan.score + tie;
    if (score > bestScore) { bestScore = score; bestCell = c; }
  }
  if (bestCell >= 0) return { t: 'move', path: reach.get(bestCell)! };

  const canAct = f.spells.some((s) => usable(st, f, s) && isHostile(spellOf(st, s.id)));
  if (!canAct) {
    // Nothing left to cast: shooters step back, the rest stay.
    if (f.ai === 'melee' || kited) return null;
    let far = -1, farD = nearest(f.cell);
    for (const [c] of reach) {
      const d = nearest(c);
      if (d > farD && d <= 6) { farD = d; far = c; }
    }
    return far >= 0 ? { t: 'move', path: reach.get(far)! } : null;
  }

  // Close the distance.
  const targetCells = new Set<number>();
  for (const o of foes) for (const n of neighbors(o.cell)) targetCells.add(n);
  if (targetCells.has(f.cell)) return null;
  const path = findPath(f.cell, (i) => targetCells.has(i), (i) => free(st, i));
  if (path && path.length) return { t: 'move', path: path.slice(0, f.mp) };
  // Blocked: take the reachable cell closest to an enemy.
  let near = -1, nearD = nearest(f.cell);
  for (const [c] of reach) {
    const d = nearest(c);
    if (d < nearD) { nearD = d; near = c; }
  }
  return near >= 0 ? { t: 'move', path: reach.get(near)! } : null;
}

/** Play a whole turn for a fighter (monsters, and the player in auto-play). The turn is not ended. */
export function aiTurn(st: FightState, f: Fighter, rng: Rng): FEvent[] {
  const ev: FEvent[] = [];
  let kited = false;
  for (let guard = 0; guard < 16 && f.alive && !st.over; guard++) {
    const plan = planStep(st, f, kited);
    if (!plan) break;
    if (plan.t === 'cast') {
      const res = cast(st, f, plan.spell, plan.cell, rng);
      if (!res.length) break;
      ev.push(...res);
    } else {
      const before = f.cell;
      if (!f.spells.some((s) => usable(st, f, s) && isHostile(spellOf(st, s.id)))) kited = true;
      ev.push(...move(st, f, plan.path, rng));
      if (f.cell === before) break;
    }
  }
  return ev;
}
