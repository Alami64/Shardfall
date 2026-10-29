/**
 * Combat formulas from the design doc (Tactical combat > Formulas), as pure
 * functions of stats. The engine applies them; they are tested on their own.
 */
import type { Element } from './spell.js';
import type { FighterStats } from './stats.js';

/** Players' % resistances never count above this. */
export const PLAYER_RESIST_CAP = 50;
/** AP/MP removal chance per point is clamped to this range. */
export const REMOVAL_MIN_CHANCE = 0.1;
export const REMOVAL_MAX_CHANCE = 0.9;
/** Share of the HP a steal effect takes that heals the caster. */
export const STEAL_RATE = 0.5;

/**
 * The characteristic that scales an element: Earth and Neutral = Strength,
 * Fire = Intelligence, Water = Chance, Air = Agility.
 */
export function characteristicFor(stats: FighterStats, element: Element): number {
  switch (element) {
    case 'neutral':
    case 'earth':
      return stats.strength;
    case 'fire':
      return stats.intelligence;
    case 'water':
      return stats.chance;
    case 'air':
      return stats.agility;
  }
}

/**
 * Damage before resistances: ⌊base × (100 + characteristic + power) / 100⌋ +
 * flat damage of the element, plus Critical Damage on a critical hit. The
 * multiplier never goes below 0 and neither does the result.
 */
export function directDamage(base: number, attacker: FighterStats, element: Element, critical: boolean): number {
  const percent = Math.max(0, 100 + characteristicFor(attacker, element) + attacker.power);
  const flat = attacker.damage[element] + (critical ? attacker.criticalDamage : 0);
  return Math.max(0, Math.floor((base * percent) / 100) + flat);
}

/**
 * Damage after resistances: max(0, ⌊dmg × (100 − res%) / 100⌋ − flat res).
 * Players' res% is capped at 50; monsters may go higher, or below 0 for a weakness.
 */
export function resistedDamage(dmg: number, defender: FighterStats, element: Element, isPlayer: boolean): number {
  const raw = defender.resistPercent[element];
  const percent = isPlayer ? Math.min(PLAYER_RESIST_CAP, raw) : raw;
  return Math.max(0, Math.floor((dmg * (100 - percent)) / 100) - defender.resistFlat[element]);
}

/** Heal amount: ⌊base × (100 + Intelligence) / 100⌋ + Heals, never below 0. */
export function healAmount(base: number, healer: FighterStats): number {
  const percent = Math.max(0, 100 + healer.intelligence);
  return Math.max(0, Math.floor((base * percent) / 100) + healer.heals);
}

/**
 * Tackle escape share: (dodge + 2) / (2 × (lock + 2)), where lock is the total
 * Lock of the adjacent enemies. 1 or more means no loss. Negative stats count as 0.
 */
export function tackleEscape(dodge: number, lock: number): number {
  return (Math.max(0, dodge) + 2) / (2 * (Math.max(0, lock) + 2));
}

/** Points kept after a tackle: the escape share of the remaining points, rounded down. */
export function pointsAfterTackle(points: number, escape: number): number {
  return escape >= 1 ? points : Math.floor(points * escape);
}

/**
 * Chance that one AP or MP point is removed:
 * 0.5 × removal / parry × current / max, clamped to 10%–90%.
 * Removal and parry below 1 count as 1, so two fighters without either stat
 * start at 50%; with no points left, nothing can be removed.
 */
export function removalChance(removal: number, parry: number, current: number, max: number): number {
  if (current <= 0 || max <= 0) return 0;
  const p = (0.5 * Math.max(1, removal) * (current / max)) / Math.max(1, parry);
  return Math.min(REMOVAL_MAX_CHANCE, Math.max(REMOVAL_MIN_CHANCE, p));
}
