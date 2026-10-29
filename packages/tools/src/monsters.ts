/**
 * Zod schema for monster content (content/monsters/*.json) and the checks
 * against the spell catalogue that the schema cannot express. Typed against the
 * shared Monster type, so the two cannot drift apart.
 */
import { z } from 'zod';
import { ARCHETYPES, ELEMENTS, MAX_LEVEL, SCALAR_STATS, type Monster, type Spell } from '@shardfall/shared';

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'use lower_snake_case');
const perElement = z.strictObject(Object.fromEntries(ELEMENTS.map((e) => [e, z.number().optional()])));
const scalarStats = Object.fromEntries(['maxHp', ...SCALAR_STATS].map((s) => [s, z.number().optional()]));

const stats = z.strictObject({
  ...scalarStats,
  damage: perElement.optional(),
  resistPercent: perElement.optional(),
  resistFlat: perElement.optional(),
});

const grade = z.strictObject({
  level: z.number().int().min(1).max(MAX_LEVEL),
  stats,
  spells: z.array(z.strictObject({ spellId: id, grade: z.number().int().min(1) })).min(1),
});

export const monsterSchema: z.ZodType<Monster> = z.strictObject({
  id,
  name: z.string().min(1),
  ai: z.strictObject({ archetype: z.enum(ARCHETYPES), preferredRange: z.number().int().min(1) }),
  grades: z.array(grade).min(1).max(5),
});

/** One content file: a list of monsters, usually one family or area. */
export const monsterFileSchema = z.array(monsterSchema);

/** Unique ids, levels rising grade by grade, max HP set, and every spell present in the catalogue at that grade. */
export function checkMonsters(monsters: readonly Monster[], spells: readonly Spell[]): string[] {
  const errors: string[] = [];
  const byId = new Map(spells.map((s) => [s.id, s]));
  const ids = new Set<string>();
  for (const m of monsters) {
    if (ids.has(m.id)) errors.push(`${m.id}: duplicate monster id`);
    ids.add(m.id);
    m.grades.forEach((g, i) => {
      const where = `${m.id} grade ${i + 1}`;
      const previous = m.grades[i - 1];
      if (previous && g.level <= previous.level) {
        errors.push(`${where}: level ${g.level} must be above ${previous.level}`);
      }
      if (!g.stats.maxHp || g.stats.maxHp < 1) errors.push(`${where}: stats.maxHp is required`);
      for (const slot of g.spells) {
        const spell = byId.get(slot.spellId);
        if (!spell) errors.push(`${where}: unknown spell ${slot.spellId}`);
        else if (!spell.grades[slot.grade - 1]) errors.push(`${where}: ${slot.spellId} has no grade ${slot.grade}`);
      }
    });
  }
  return errors;
}
