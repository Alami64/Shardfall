/**
 * Player characters as they enter a fight (design doc, Characters > Leveling,
 * Spells): characteristic points by level, the launch class builds, and the
 * spell bar from a loadout (one spell per unlocked pair, at the grade the
 * level gives).
 */
import type { FighterSetup, SpellSlot, Team } from './fightState.js';
import type { AiProfile } from './monster.js';
import { MAX_LEVEL, spellGradeForLevel, type Spell } from './spell.js';
import { characterAp, characterMaxHp, fighterStats, type FighterStats } from './stats.js';

/** Characteristic points gained per level after the first. */
export const POINTS_PER_LEVEL = 5;

/** The levels at which a class's ten spell pairs unlock, in pair order. */
export const PAIR_UNLOCK_LEVELS = [1, 3, 6, 10, 15, 20, 26, 33, 40, 48] as const;

/** The characteristics points can go into. */
export type Characteristic = 'vitality' | 'wisdom' | 'strength' | 'intelligence' | 'chance' | 'agility';

/**
 * What one more point of a characteristic costs at `value`: 1 point up to 100,
 * 2 up to 200, 3 up to 300, 4 beyond. Vitality always costs 1, Wisdom 3.
 */
export function pointCost(characteristic: Characteristic, value: number): number {
  if (characteristic === 'vitality') return 1;
  if (characteristic === 'wisdom') return 3;
  return Math.min(4, Math.floor(value / 100) + 1);
}

/** The value a characteristic reaches from `from` when `points` are spent on it; leftover points that buy nothing are lost. */
export function characteristicFromPoints(characteristic: Characteristic, points: number, from = 0): number {
  let value = from;
  let left = points;
  while (left >= pointCost(characteristic, value)) {
    left -= pointCost(characteristic, value);
    value++;
  }
  return value;
}

/** How a launch class spends its points: everything into `main`, on top of the fixed `base` stats. */
export interface ClassBuild {
  classId: string;
  name: string;
  main: 'strength' | 'intelligence' | 'chance' | 'agility';
  base: Partial<FighterStats>;
  /** How the AI plays the class when it stands in for a player. */
  ai: AiProfile;
}

export const CLASS_BUILDS: readonly ClassBuild[] = [
  {
    classId: 'vanguard',
    name: 'Vanguard',
    main: 'strength',
    base: { strength: 5, agility: 10, initiative: 10 },
    ai: { archetype: 'brute', preferredRange: 1 },
  },
  {
    classId: 'longshot',
    name: 'Longshot',
    main: 'agility',
    base: { agility: 5, intelligence: 10 },
    ai: { archetype: 'caster', preferredRange: 5 },
  },
  {
    classId: 'mender',
    name: 'Mender',
    main: 'intelligence',
    base: { intelligence: 5, chance: 10 },
    ai: { archetype: 'caster', preferredRange: 4 },
  },
];

/** Which spell of each pair is on the bar: pairId → spellId. */
export type Loadout = Record<string, string>;

/** A class's spells grouped by pair, in unlock order; within a pair, in catalogue order. */
export function spellPairs(spells: readonly Spell[], classId: string): Spell[][] {
  const pairs = new Map<string, Spell[]>();
  for (const s of spells) {
    if (s.classId !== classId) continue;
    pairs.set(s.pairId, [...(pairs.get(s.pairId) ?? []), s]);
  }
  return [...pairs.values()].sort((a, b) => a[0]!.unlockLevel - b[0]!.unlockLevel);
}

/** The first spell of every pair. */
export function defaultLoadout(spells: readonly Spell[], classId: string): Loadout {
  return Object.fromEntries(spellPairs(spells, classId).map((pair) => [pair[0]!.pairId, pair[0]!.id]));
}

/** The bar a loadout gives at `level`: one spell per unlocked pair (the default side when the loadout names none or a wrong one). */
export function loadoutSlots(spells: readonly Spell[], classId: string, level: number, loadout: Loadout = {}): SpellSlot[] {
  const slots: SpellSlot[] = [];
  for (const pair of spellPairs(spells, classId)) {
    const chosen = pair.find((s) => s.id === loadout[pair[0]!.pairId]) ?? pair[0]!;
    const grade = spellGradeForLevel(chosen, level);
    if (grade > 0) slots.push({ spellId: chosen.id, grade });
  }
  return slots;
}

/** The stats of a class build at `level`, before gear. */
export function heroStats(build: ClassBuild, level: number): FighterStats {
  const points = POINTS_PER_LEVEL * (Math.max(1, level) - 1);
  const main = characteristicFromPoints(build.main, points, build.base[build.main] ?? 0);
  return fighterStats({ ...build.base, [build.main]: main, level, ap: characterAp(level), maxHp: characterMaxHp(level, 0) });
}

export interface HeroOptions {
  level: number;
  loadout?: Loadout;
  team?: Team;
}

/** A player character of a launch class, ready to join a fight. */
export function heroSetup(classId: string, spells: readonly Spell[], { level, loadout, team = 'A' }: HeroOptions): FighterSetup {
  const build = CLASS_BUILDS.find((b) => b.classId === classId);
  if (!build) throw new Error(`unknown class ${classId}`);
  const capped = Math.min(MAX_LEVEL, Math.max(1, Math.floor(level)));
  return {
    id: classId,
    name: build.name,
    team,
    controller: 'player',
    // Kept so the AI can stand in for a player (fight simulations); the player drives these in the client.
    ai: { ...build.ai },
    spells: loadoutSlots(spells, classId, capped, loadout),
    stats: heroStats(build, capped),
  };
}
