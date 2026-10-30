/**
 * Zod schema for spell content (content/spells/*.json) and the cross-spell
 * checks the schema cannot express. The schema is typed against the shared
 * Spell type, so the two cannot drift apart.
 */
import { z } from 'zod';
import {
  EFFECT_KINDS,
  EFFECT_TARGETS,
  ELEMENTS,
  ELEMENT_STATS,
  MAX_LEVEL,
  SCALAR_STATS,
  ZONE_SHAPES,
  isElementStat,
  isScalarStat,
  type Effect,
  type Spell,
} from '@shardfall/shared';

const count = z.number().int().nonnegative();
const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'use lower_snake_case');

const zone = z.strictObject({ shape: z.enum(ZONE_SHAPES), size: count });

const effect = z.strictObject({
  kind: z.enum(EFFECT_KINDS),
  element: z.enum(ELEMENTS).optional(),
  min: z.number().int().optional(),
  max: z.number().int().optional(),
  duration: count.optional(),
  zone,
  targets: z.array(z.enum(EFFECT_TARGETS)).min(1),
  requiresState: z.string().min(1).optional(),
  forbidsState: z.string().min(1).optional(),
  params: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
});

const grade = z.strictObject({
  apCost: count,
  minRange: count,
  maxRange: count,
  rangeBoostable: z.boolean(),
  castInLine: z.boolean(),
  castInDiagonal: z.boolean(),
  needsLineOfSight: z.boolean(),
  needsFreeCell: z.boolean(),
  castsPerTurn: count,
  castsPerTarget: count,
  cooldown: count,
  initialCooldown: count,
  criticalChance: z.number().min(0).max(100),
  effects: z.array(effect).min(1),
  criticalEffects: z.array(effect),
});

export const spellSchema: z.ZodType<Spell> = z.strictObject({
  id,
  classId: id,
  name: z.string().min(1),
  unlockLevel: z.number().int().min(1).max(MAX_LEVEL),
  pairId: id,
  grades: z.array(grade).min(1).max(3),
});

/** One content file: a list of spells, usually one class. */
export const spellFileSchema = z.array(spellSchema);

/** Effect kinds whose amount is rolled from min..max. */
const ROLLED: ReadonlySet<Effect['kind']> = new Set([
  'damage',
  'steal',
  'heal',
  'buff',
  'debuff',
  'removeAP',
  'removeMP',
]);
const ELEMENTAL: ReadonlySet<Effect['kind']> = new Set(['damage', 'steal']);
const UNSUPPORTED: ReadonlySet<Effect['kind']> = new Set(['summon', 'glyph', 'trap']);

const positiveInt = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0;

/** What each effect kind needs from min/max, element, duration and params (design doc, Spells > Effects). */
function checkEffect(e: Effect, where: string): string[] {
  const errors: string[] = [];
  const p = e.params ?? {};
  if (UNSUPPORTED.has(e.kind)) errors.push(`${where}: ${e.kind} effects are not supported yet`);
  if (ROLLED.has(e.kind) && (e.min === undefined || e.max === undefined)) {
    errors.push(`${where}: ${e.kind} needs min and max`);
  }
  if (e.min !== undefined && e.max !== undefined && e.min > e.max) errors.push(`${where}: min ${e.min} > max ${e.max}`);
  if (ELEMENTAL.has(e.kind) && !e.element) errors.push(`${where}: ${e.kind} needs an element`);
  if (e.kind === 'steal' && (e.duration ?? 0) > 0) errors.push(`${where}: steal cannot last; use damage with a duration`);
  if (e.zone.shape === 'single' && e.zone.size !== 0) errors.push(`${where}: a single-cell zone has size 0`);
  switch (e.kind) {
    case 'buff':
    case 'debuff': {
      const stat = typeof p.stat === 'string' ? p.stat : '';
      if (!isScalarStat(stat) && !isElementStat(stat)) {
        errors.push(`${where}: params.stat must be one of ${[...SCALAR_STATS, ...ELEMENT_STATS].join(', ')}`);
      } else if (isScalarStat(stat) && e.element) {
        errors.push(`${where}: element only applies to ${ELEMENT_STATS.join(', ')}`);
      }
      if ((e.duration ?? 0) === 0 && stat !== 'ap' && stat !== 'mp') {
        errors.push(`${where}: only ap and mp changes can be instant; give a duration`);
      }
      break;
    }
    case 'push':
    case 'pull':
      if (!positiveInt(p.cells)) errors.push(`${where}: ${e.kind} needs params.cells, a positive integer`);
      break;
    case 'state':
      if (typeof p.state !== 'string' || !p.state) errors.push(`${where}: state needs params.state`);
      break;
    case 'shield':
      if (p.maxHpPercent === undefined && (e.min === undefined || e.max === undefined)) {
        errors.push(`${where}: shield needs min and max, or params.maxHpPercent`);
      }
      if (p.maxHpPercent !== undefined && !positiveInt(p.maxHpPercent)) {
        errors.push(`${where}: params.maxHpPercent must be a positive integer`);
      }
      break;
    case 'teleport':
      if (!e.targets.includes('cell')) errors.push(`${where}: teleport targets the cell`);
      break;
    case 'revive':
      if (!e.targets.includes('cell')) errors.push(`${where}: revive targets the cell`);
      if (!positiveInt(p.hpPercent) || Number(p.hpPercent) > 100) {
        errors.push(`${where}: revive needs params.hpPercent, 1 to 100`);
      }
      break;
  }
  return errors;
}

/** Rules across fields and spells: ranges, rolls, unique ids, and pairs (two spells, same class and unlock level). */
export function checkSpells(spells: readonly Spell[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const pairs = new Map<string, Spell[]>();
  for (const s of spells) {
    if (ids.has(s.id)) errors.push(`${s.id}: duplicate spell id`);
    ids.add(s.id);
    const pair = pairs.get(s.pairId) ?? [];
    pair.push(s);
    pairs.set(s.pairId, pair);

    s.grades.forEach((g, i) => {
      const where = `${s.id} grade ${i + 1}`;
      if (g.minRange > g.maxRange) errors.push(`${where}: minRange ${g.minRange} > maxRange ${g.maxRange}`);
      if (g.criticalChance > 0 && g.criticalEffects.length === 0) {
        errors.push(`${where}: criticalChance is set but there are no criticalEffects`);
      }
      g.effects.forEach((e, j) => errors.push(...checkEffect(e, `${where} effect ${j + 1}`)));
      g.criticalEffects.forEach((e, j) => errors.push(...checkEffect(e, `${where} critical effect ${j + 1}`)));
    });
  }
  for (const [pairId, members] of pairs) {
    if (members.length > 2) errors.push(`pair ${pairId}: ${members.length} spells, at most 2`);
    const [first, ...rest] = members;
    for (const m of rest) {
      if (m.classId !== first!.classId || m.unlockLevel !== first!.unlockLevel) {
        errors.push(`pair ${pairId}: ${first!.id} and ${m.id} differ in class or unlock level`);
      }
    }
  }
  return errors;
}
