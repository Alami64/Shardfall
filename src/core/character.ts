// The player's character: stats, levels, inventory, equipment.
import {
  ITEMS, LEVEL_CAP, MAX_RANK, PLAYER_SPELLS, rankCost, sellPrice, SETS, xpNeed,
  type ItemDef, type SpellDef, type StatKey,
} from './content.js';
import type { Fighter } from './fight.js';
import { rint, type Rng } from './rng.js';

export interface HeroLook { tunic: string; hair: string; skin: string }
export interface ItemInst { uid: number; def: string; qty: number; stats?: Partial<Record<StatKey, number>> }
export const SLOTS = ['weapon', 'helm', 'cloak', 'amulet', 'ring1', 'ring2', 'belt', 'boots'] as const;
export type Slot = (typeof SLOTS)[number];
export const SLOT_LABEL: Record<Slot, string> = {
  weapon: 'Weapon', helm: 'Helm', cloak: 'Cloak', amulet: 'Amulet', ring1: 'Ring', ring2: 'Ring', belt: 'Belt', boots: 'Boots',
};
export type BaseStat = 'vit' | 'str' | 'int' | 'agi' | 'luck';
export const BASE_STATS: BaseStat[] = ['vit', 'str', 'int', 'agi', 'luck'];

export interface Character {
  name: string;
  look: HeroLook;
  level: number;
  xp: number;
  base: Record<BaseStat, number>;
  statPoints: number;
  spellPoints: number;
  ranks: Record<string, number>;
  hp: number;
  gold: number;
  inv: ItemInst[];
  equip: Record<Slot, ItemInst | null>;
  mapId: string;
  cell: number;
  quest: number;
  questProg: number;
  questTaken: boolean;
  uidSeq: number;
  wins: number;
}

export function newCharacter(name: string, look: HeroLook): Character {
  const ch: Character = {
    name, look, level: 1, xp: 0,
    base: { vit: 0, str: 0, int: 0, agi: 0, luck: 0 },
    statPoints: 0, spellPoints: 0, ranks: {}, hp: 1, gold: 20, inv: [],
    equip: { weapon: null, helm: null, cloak: null, amulet: null, ring1: null, ring2: null, belt: null, boots: null },
    mapId: 'village', cell: -1, quest: 0, questProg: 0, questTaken: false, uidSeq: 1, wins: 0,
  };
  ch.hp = derived(ch).maxHp;
  return ch;
}

const ALL_STATS: StatKey[] = ['vit', 'str', 'int', 'agi', 'luck', 'ap', 'mp', 'power', 'dmg', 'crit', 'init', 'resPhysical', 'resFire', 'resStorm'];

export function setCounts(ch: Character): Record<string, number> {
  const n: Record<string, number> = {};
  for (const s of SLOTS) {
    const set = ch.equip[s] && ITEMS[ch.equip[s]!.def]!.set;
    if (set) n[set] = (n[set] ?? 0) + 1;
  }
  return n;
}

/** Stats from points, equipment and set bonuses added up. */
export function totals(ch: Character): Record<StatKey, number> {
  const t = Object.fromEntries(ALL_STATS.map((k) => [k, 0])) as Record<StatKey, number>;
  for (const k of BASE_STATS) t[k] += ch.base[k];
  for (const s of SLOTS) {
    const it = ch.equip[s];
    if (it?.stats) for (const [k, v] of Object.entries(it.stats)) t[k as StatKey] += v!;
  }
  for (const [set, count] of Object.entries(setCounts(ch))) {
    let best = 0;
    for (const need of Object.keys(SETS[set]!.bonus).map(Number)) if (count >= need && need > best) best = need;
    if (best) for (const [k, v] of Object.entries(SETS[set]!.bonus[best]!)) t[k as StatKey] += v!;
  }
  return t;
}

export interface Derived extends Record<StatKey, number> { maxHp: number }

export function derived(ch: Character): Derived {
  const t = totals(ch);
  return {
    ...t,
    maxHp: 50 + (ch.level - 1) * 6 + t.vit,
    ap: 6 + t.ap,
    mp: 3 + t.mp,
    crit: 5 + Math.floor(t.agi / 20) + Math.floor(t.luck / 10) + t.crit,
    init: 100 + t.agi + Math.floor((t.str + t.int) / 2) + t.init,
  };
}

/** Add XP; returns how many levels were gained. */
export function gainXp(ch: Character, n: number): number {
  let gained = 0;
  if (ch.level >= LEVEL_CAP) return 0;
  ch.xp += n;
  while (ch.level < LEVEL_CAP && ch.xp >= xpNeed(ch.level)) {
    ch.xp -= xpNeed(ch.level);
    ch.level++;
    ch.statPoints += 5;
    ch.spellPoints += 1;
    gained++;
  }
  if (ch.level >= LEVEL_CAP) ch.xp = 0;
  if (gained) ch.hp = derived(ch).maxHp;
  return gained;
}

export const knownSpells = (ch: Character): SpellDef[] => PLAYER_SPELLS.filter((s) => s.level <= ch.level);
export const rankOf = (ch: Character, id: string) => ch.ranks[id] ?? 1;

export function raiseStat(ch: Character, k: BaseStat, n = 1): boolean {
  n = Math.min(n, ch.statPoints);
  if (n <= 0) return false;
  ch.base[k] += n;
  ch.statPoints -= n;
  if (k === 'vit') ch.hp += n;
  return true;
}

export function raiseSpell(ch: Character, id: string): boolean {
  const r = rankOf(ch, id);
  const sp = PLAYER_SPELLS.find((s) => s.id === id);
  if (!sp || sp.level > ch.level || r >= MAX_RANK || ch.spellPoints < rankCost(r)) return false;
  ch.spellPoints -= rankCost(r);
  ch.ranks[id] = r + 1;
  return true;
}

/** Take back every spent characteristic point. Returns how many came back. */
export function resetStats(ch: Character): number {
  let refund = 0;
  for (const k of BASE_STATS) { refund += ch.base[k]; ch.base[k] = 0; }
  ch.statPoints += refund;
  clampHp(ch);
  return refund;
}

/** Put every spell back to rank 1. Returns how many spell points came back. */
export function resetSpells(ch: Character): number {
  let refund = 0;
  for (const rank of Object.values(ch.ranks)) for (let r = 1; r < rank; r++) refund += rankCost(r);
  ch.ranks = {};
  ch.spellPoints += refund;
  return refund;
}

// ------------------------------------------------------------ items

export const isGear = (def: ItemDef) => def.type !== 'resource' && def.type !== 'food';

/** Add an item. Equipment gets its stats rolled; the rest stacks. */
export function addItem(ch: Character, defId: string, qty: number, rng: Rng): ItemInst {
  const def = ITEMS[defId]!;
  if (!isGear(def)) {
    const have = ch.inv.find((i) => i.def === defId);
    if (have) { have.qty += qty; return have; }
    const inst: ItemInst = { uid: ch.uidSeq++, def: defId, qty };
    ch.inv.push(inst);
    return inst;
  }
  let inst!: ItemInst;
  for (let k = 0; k < qty; k++) {
    const stats: Partial<Record<StatKey, number>> = {};
    for (const [key, range] of Object.entries(def.stats ?? {})) stats[key as StatKey] = rint(rng, range![0], range![1]);
    inst = { uid: ch.uidSeq++, def: defId, qty: 1, stats };
    ch.inv.push(inst);
  }
  return inst;
}

function removeOne(ch: Character, uid: number): ItemInst | null {
  const i = ch.inv.findIndex((x) => x.uid === uid);
  if (i < 0) return null;
  const it = ch.inv[i]!;
  if (it.qty > 1) { it.qty--; return { ...it, qty: 1 }; }
  ch.inv.splice(i, 1);
  return it;
}

function clampHp(ch: Character) { ch.hp = Math.max(1, Math.min(ch.hp, derived(ch).maxHp)); }

/** Equip an item from the bag. Returns an error text or null. */
export function equipItem(ch: Character, uid: number): string | null {
  const it = ch.inv.find((x) => x.uid === uid);
  if (!it) return 'No such item';
  const def = ITEMS[it.def]!;
  if (!isGear(def)) return 'Cannot be equipped';
  if (def.level > ch.level) return `Requires level ${def.level}`;
  let slot: Slot;
  if (def.type === 'ring') slot = !ch.equip.ring1 ? 'ring1' : !ch.equip.ring2 ? 'ring2' : 'ring1';
  else slot = def.type as Slot;
  ch.inv.splice(ch.inv.indexOf(it), 1);
  const old = ch.equip[slot];
  if (old) ch.inv.push(old);
  ch.equip[slot] = it;
  clampHp(ch);
  return null;
}

export function unequip(ch: Character, slot: Slot) {
  const it = ch.equip[slot];
  if (!it) return;
  ch.equip[slot] = null;
  ch.inv.push(it);
  clampHp(ch);
}

export function useItem(ch: Character, uid: number): string | null {
  const it = ch.inv.find((x) => x.uid === uid);
  const def = it && ITEMS[it.def];
  if (!def?.heal) return 'Cannot be used';
  const max = derived(ch).maxHp;
  if (ch.hp >= max) return 'Already at full health';
  removeOne(ch, uid);
  ch.hp = Math.min(max, ch.hp + def.heal);
  return null;
}

export function sellItem(ch: Character, uid: number): number {
  const it = removeOne(ch, uid);
  if (!it) return 0;
  const g = sellPrice(ITEMS[it.def]!);
  ch.gold += g;
  return g;
}

export function buyItem(ch: Character, defId: string, rng: Rng): string | null {
  const def = ITEMS[defId]!;
  if (ch.gold < def.price) return 'Not enough gold';
  ch.gold -= def.price;
  addItem(ch, defId, 1, rng);
  return null;
}

// ------------------------------------------------------------ fights

export const WEAPON_SPELL = 'weapon';

/** The weapon attack as a spell for this fight (bare hands without a weapon). */
export function weaponSpell(ch: Character): SpellDef {
  const def = ch.equip.weapon ? ITEMS[ch.equip.weapon.def]! : null;
  const a = def?.attack ?? { ap: 3, range: [1, 1] as [number, number], el: 'physical' as const, min: 2, max: 4 };
  return {
    id: WEAPON_SPELL, name: def ? def.name : 'Bare Hands', icon: def ? 'weapon' : 'fist', color: def?.color ?? '#e8d9b5',
    level: 1, ap: a.ap, range: a.range, los: a.range[1] > 1, target: 'fighter',
    effects: [{ k: 'damage', el: a.el, min: a.min, max: a.max }],
    desc: def ? 'Strike with your equipped weapon.' : 'Strike with your fists. Equip a weapon for more.',
  };
}

export function playerFighter(ch: Character, cell: number): Fighter {
  const d = derived(ch);
  return {
    id: 0, team: 0, name: ch.name, kind: 'player', level: ch.level, cell,
    hp: Math.max(1, Math.min(ch.hp, d.maxHp)), maxHp: d.maxHp,
    ap: d.ap, mp: d.mp, baseAp: d.ap, baseMp: d.mp,
    str: d.str, int: d.int, agi: d.agi, luck: d.luck, power: d.power, dmg: d.dmg, crit: d.crit, init: d.init,
    res: { physical: d.resPhysical, fire: d.resFire, storm: d.resStorm },
    spells: [
      { id: WEAPON_SPELL, rank: 1, cd: 0, used: 0 },
      ...knownSpells(ch).map((s) => ({ id: s.id, rank: rankOf(ch, s.id), cd: 0, used: 0 })),
    ],
    buffs: [], alive: true, ai: 'melee',
  };
}
