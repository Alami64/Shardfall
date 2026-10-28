/** Character stat rules from the design doc (Characters > Characteristics). */

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
