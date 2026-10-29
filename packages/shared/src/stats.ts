/** Character and fighter stats (design doc, Characters > Characteristics). */
import type { Element } from './spell.js';

export const BASE_AP = 6;
export const BASE_MP = 3;
/** Level at which characters gain their 7th AP. */
export const BONUS_AP_LEVEL = 100;

/** Max HP before gear: 55 + 5 per level + Vitality. */
export function characterMaxHp(level: number, vitality: number): number {
  return 55 + 5 * level + vitality;
}

/** Base AP: 6, plus 1 from level 100. */
export function characterAp(level: number): number {
  return level >= BONUS_AP_LEVEL ? BASE_AP + 1 : BASE_AP;
}

export type PerElement = Record<Element, number>;

export const perElement = (value = 0): PerElement => ({
  neutral: value,
  earth: value,
  fire: value,
  water: value,
  air: value,
});

/** A fighter's stats as it enters the fight, after gear. Buffs come on top during the fight. */
export interface FighterStats {
  level: number;
  maxHp: number;
  ap: number;
  mp: number;
  /** Bonus range for spells whose range is boostable; may be negative. */
  range: number;
  /** Bonus initiative from gear and passives. */
  initiative: number;
  strength: number;
  intelligence: number;
  chance: number;
  agility: number;
  /** Added to the characteristic of every damage element. */
  power: number;
  /** Added to a spell's critical chance, in %. */
  criticalChance: number;
  /** Added to the damage of critical hits. */
  criticalDamage: number;
  /** Added to every heal. */
  heals: number;
  dodge: number;
  lock: number;
  apParry: number;
  mpParry: number;
  apRemoval: number;
  mpRemoval: number;
  /** Flat damage added per element. */
  damage: PerElement;
  resistPercent: PerElement;
  resistFlat: PerElement;
}

/** Stats a buff or debuff can change by a flat amount. */
export const SCALAR_STATS = [
  'ap',
  'mp',
  'range',
  'initiative',
  'strength',
  'intelligence',
  'chance',
  'agility',
  'power',
  'criticalChance',
  'criticalDamage',
  'heals',
  'dodge',
  'lock',
  'apParry',
  'mpParry',
  'apRemoval',
  'mpRemoval',
] as const;
export type ScalarStat = (typeof SCALAR_STATS)[number];

/** Per-element stats a buff can change, for one element or all of them. */
export const ELEMENT_STATS = ['damage', 'resistPercent', 'resistFlat'] as const;
export type ElementStat = (typeof ELEMENT_STATS)[number];

export const isScalarStat = (s: string): s is ScalarStat => (SCALAR_STATS as readonly string[]).includes(s);
export const isElementStat = (s: string): s is ElementStat => (ELEMENT_STATS as readonly string[]).includes(s);

/** Level-1 stats with nothing from gear, overridden by `overrides`. */
export function fighterStats(overrides: Partial<FighterStats> = {}): FighterStats {
  return {
    level: 1,
    maxHp: characterMaxHp(1, 0),
    ap: BASE_AP,
    mp: BASE_MP,
    range: 0,
    initiative: 0,
    strength: 0,
    intelligence: 0,
    chance: 0,
    agility: 0,
    power: 0,
    criticalChance: 0,
    criticalDamage: 0,
    heals: 0,
    dodge: 0,
    lock: 0,
    apParry: 0,
    mpParry: 0,
    apRemoval: 0,
    mpRemoval: 0,
    damage: perElement(),
    resistPercent: perElement(),
    resistFlat: perElement(),
    ...overrides,
  };
}
