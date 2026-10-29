/**
 * Spell data model (design doc, Spells > Data model). Spells, monster spells and
 * weapon attacks all use these types; the content lives in content/spells/*.json
 * and is validated by the tools package at build time.
 */

export const ELEMENTS = ['neutral', 'earth', 'fire', 'water', 'air'] as const;
export type Element = (typeof ELEMENTS)[number];

export const ZONE_SHAPES = ['single', 'circle', 'cross', 'line', 'cone', 'square', 'ring'] as const;
export type ZoneShape = (typeof ZONE_SHAPES)[number];

/** An area. `size` counts cells beyond the centre, so size 0 is always just the centre. */
export interface Zone {
  shape: ZoneShape;
  size: number;
}

export const EFFECT_KINDS = [
  'damage',
  'steal',
  'heal',
  'buff',
  'debuff',
  'push',
  'pull',
  'teleport',
  'swap',
  'summon',
  'glyph',
  'trap',
  'state',
  'removeAP',
  'removeMP',
  'shield',
  'revive',
] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

/**
 * Who an effect applies to. `self`, `allies` and `enemies` are fighters inside
 * the effect's area; `caster` is the caster wherever the area is (a recoil, a
 * dash); `cell` is the target cell itself (teleport, revive).
 */
export const EFFECT_TARGETS = ['enemies', 'allies', 'self', 'caster', 'summons', 'cell'] as const;
export type EffectTarget = (typeof EFFECT_TARGETS)[number];

export interface Effect {
  kind: EffectKind;
  element?: Element;
  /** Rolled per cast. */
  min?: number;
  max?: number;
  /** Turns; 0 = instant. */
  duration?: number;
  zone: Zone;
  targets: EffectTarget[];
  requiresState?: string;
  forbidsState?: string;
  params?: Record<string, number | string>;
}

export interface SpellGrade {
  apCost: number;
  minRange: number;
  maxRange: number;
  /** Whether +Range from gear and buffs extends maxRange. */
  rangeBoostable: boolean;
  /** Target must share a grid axis with the caster. */
  castInLine: boolean;
  /** Target must sit on a grid diagonal of the caster. With castInLine, either is allowed. */
  castInDiagonal: boolean;
  needsLineOfSight: boolean;
  /** Target cell must hold no fighter. */
  needsFreeCell: boolean;
  /** 0 = unlimited. */
  castsPerTurn: number;
  /** Casts per turn on the same fighter; 0 = unlimited. */
  castsPerTarget: number;
  /** Turns between casts: cast on turn t, castable again on the caster's turn t + cooldown. */
  cooldown: number;
  /** Caster turns at the start of the fight before the first cast: castable from turn 1 + initialCooldown. */
  initialCooldown: number;
  /** %. */
  criticalChance: number;
  effects: Effect[];
  criticalEffects: Effect[];
}

export interface Spell {
  id: string;
  classId: string;
  name: string;
  unlockLevel: number;
  pairId: string;
  /** One to three grades, weakest first. */
  grades: SpellGrade[];
}

/** The built spell file, content/spells/built/spells.json. */
export interface SpellCatalogue {
  spells: Spell[];
}

/** Levels after unlock at which grades 2 and 3 arrive. */
export const GRADE_STEP_LEVELS = 20;
/** The level cap while the world is three regions (design doc, Characters > Leveling). */
export const MAX_LEVEL = 60;

/**
 * The grade (1-based) a character of `level` has for a spell, or 0 while the
 * spell is still locked. Grade 2 comes 20 levels after unlock and grade 3 40
 * levels after, both reached by the level cap at the latest.
 */
export function spellGradeForLevel(spell: Spell, level: number): number {
  if (level < spell.unlockLevel) return 0;
  let grade = 1;
  for (let g = 2; g <= spell.grades.length; g++) {
    const at = Math.min(spell.unlockLevel + (g - 1) * GRADE_STEP_LEVELS, MAX_LEVEL);
    if (level >= at) grade = g;
  }
  return grade;
}
