/**
 * Monster data model (design doc, Monsters, dungeons and quests). Monsters
 * fight with the same stats and spells as players; the content lives in
 * content/monsters/*.json and is validated by the tools package at build time.
 */
import type { FighterSetup, SpellSlot, Team } from './fightState.js';
import type { Element } from './spell.js';
import { fighterStats, perElement, type FighterStats, type PerElement } from './stats.js';

/** How the AI weighs its options (design doc, Monster AI). */
export const ARCHETYPES = ['brute', 'caster'] as const;
export type Archetype = (typeof ARCHETYPES)[number];

/** What the AI needs to play a fighter. */
export interface AiProfile {
  archetype: Archetype;
  /** The distance to the nearest enemy it tries to end its turn at (1 = melee). */
  preferredRange: number;
}

/** Stats a monster grade sets; everything left out keeps its level-1 default (fighterStats). */
export type MonsterStats = Partial<Omit<FighterStats, 'damage' | 'resistPercent' | 'resistFlat'>> & {
  damage?: Partial<PerElement>;
  resistPercent?: Partial<PerElement>;
  resistFlat?: Partial<PerElement>;
};

export interface MonsterGrade {
  level: number;
  stats: MonsterStats;
  spells: SpellSlot[];
}

export interface Monster {
  id: string;
  name: string;
  ai: AiProfile;
  /** One to five level variants, weakest first. */
  grades: MonsterGrade[];
}

/** The built monster file, content/monsters/built/monsters.json. */
export interface MonsterCatalogue {
  monsters: Monster[];
}

const withDefaults = (values: Partial<Record<Element, number>> = {}): PerElement => ({ ...perElement(), ...values });

/** A fighter for one grade (1-based) of a monster, controlled by the AI. */
export function monsterSetup(monster: Monster, grade: number, id: string, team: Team): FighterSetup {
  const g = monster.grades[grade - 1];
  if (!g) throw new Error(`${monster.id} has no grade ${grade}`);
  const { damage, resistPercent, resistFlat, ...scalars } = g.stats;
  return {
    id,
    name: monster.name,
    team,
    controller: 'ai',
    ai: { ...monster.ai },
    spells: g.spells.map((s) => ({ ...s })),
    stats: fighterStats({
      ...scalars,
      level: g.level,
      damage: withDefaults(damage),
      resistPercent: withDefaults(resistPercent),
      resistFlat: withDefaults(resistFlat),
    }),
  };
}
