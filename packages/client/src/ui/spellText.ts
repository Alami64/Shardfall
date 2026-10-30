/**
 * Spells in plain words, built from the spell data: what a grade costs, the
 * conditions on casting it, and what each effect does to whom. New spells in
 * content/ describe themselves.
 */
import type { Effect, EffectTarget, SpellGrade, Zone } from '@shardfall/shared';
import { STAT_LABELS } from '../fight/describe';

/** A cooldown at least this long means the spell is cast once per fight. */
const ONCE_PER_FIGHT = 99;
/** An AP or MP change at least this large means "all of them". */
const ALL_POINTS = 99;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const roll = (e: Effect) => (e.min === e.max || e.max === undefined ? `${e.min ?? 0}` : `${e.min}–${e.max}`);
const turns = (n: number) => (n === 1 ? 'until your next turn' : `for ${n} turns`);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

function who(targets: readonly EffectTarget[]): string {
  const names = targets
    .filter((t) => t !== 'cell' && t !== 'caster' && t !== 'summons')
    .map((t) => ({ enemies: 'enemies', allies: 'allies', self: 'you' })[t as 'enemies' | 'allies' | 'self']);
  if (names.length === 0) return 'the target';
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** Where an area reaches; `centre` is "the target", or "you" for spells cast on yourself. */
function area(zone: Zone, centre: string): string {
  const n = zone.size;
  if (n === 0) return '';
  switch (zone.shape) {
    case 'single':
      return '';
    case 'circle':
      return ` within ${plural(n, 'cell')} of ${centre}`;
    case 'ring':
      return ` exactly ${plural(n, 'cell')} from ${centre}`;
    case 'square':
      return ` in a square reaching ${plural(n, 'cell')} out`;
    case 'cross':
      return ` in a cross reaching ${plural(n, 'cell')} out`;
    case 'line':
      return ` on the target and the ${plural(n, 'cell')} behind it`;
    case 'cone':
      return ` in a cone ${plural(n, 'cell')} deep`;
  }
}

function stateCondition(e: Effect): string {
  if (e.requiresState) return ` (only on fighters that are ${e.requiresState})`;
  if (e.forbidsState) return ` (not on fighters that are ${e.forbidsState})`;
  return '';
}

/**
 * One effect as a sentence: "10–13 Earth damage to enemies within 1 cell of the target".
 * `selfCast` is for spells whose only target is the caster's own cell (range 0).
 */
export function effectText(e: Effect, selfCast = false): string {
  const target = who(e.targets);
  const zone = area(e.zone, selfCast ? 'you' : 'the target');
  const d = e.duration ?? 0;
  const element = e.element ? cap(e.element) : '';
  const base = (() => {
    switch (e.kind) {
      case 'damage':
        return `${roll(e)} ${element} damage to ${target}${zone}`;
      case 'steal':
        return `${roll(e)} ${element} damage to ${target}${zone}; you heal half of what it takes`;
      case 'heal':
        return `Heals ${target}${zone} for ${roll(e)} HP`;
      case 'shield': {
        const size = e.params?.maxHpPercent !== undefined ? `${e.params.maxHpPercent}% of max HP` : roll(e);
        return `Shield of ${size} on ${target}${zone}, ${turns(Math.max(1, d))}`;
      }
      case 'buff':
      case 'debuff': {
        const stat = String(e.params?.stat ?? '');
        const label = STAT_LABELS[stat] ?? stat;
        // Content writes "all of it" as a removal larger than any pool.
        if (e.kind === 'debuff' && (stat === 'ap' || stat === 'mp') && (e.min ?? 0) >= ALL_POINTS && d === 0) {
          const subject = target === 'you' ? 'You lose all your' : `${cap(target)} lose all their`;
          return `${subject} remaining ${label} this turn`;
        }
        const sign = e.kind === 'debuff' ? '−' : '+';
        const of = e.element ? ` ${e.element}` : '';
        const what = stat === 'resistPercent' ? `${roll(e)}%${of} resistance` : `${roll(e)}${of} ${label}`;
        return `${sign}${what} to ${target}${zone}, ${d > 0 ? turns(d) : 'this turn only'}`;
      }
      case 'push':
        return e.targets.includes('caster')
          ? `You recoil ${plural(Number(e.params?.cells), 'cell')} away from the target`
          : `Pushes ${target}${zone} ${plural(Number(e.params?.cells), 'cell')} away from you`;
      case 'pull':
        return e.targets.includes('caster')
          ? `You dash up to ${plural(Number(e.params?.cells), 'cell')} towards the target`
          : `Pulls ${target}${zone} ${plural(Number(e.params?.cells), 'cell')} towards you`;
      case 'removeAP':
      case 'removeMP': {
        const points = e.kind === 'removeAP' ? 'AP' : 'MP';
        return `Removes ${roll(e)} ${points} from ${target}${zone}, ${turns(Math.max(1, d))}; each point can be dodged`;
      }
      case 'state': {
        const name = String(e.params?.state ?? '');
        const meaning = name === 'rooted' ? ' (cannot be pushed, pulled or swapped)' : '';
        return `${cap(name)}${meaning} on ${target}${zone}, ${turns(Math.max(1, d))}`;
      }
      case 'teleport':
        return 'You jump to the target cell';
      case 'swap':
        return 'You swap places with the target';
      case 'revive':
        return `Revives the ally who fell last on the target cell, with ${e.params?.hpPercent}% of their HP`;
      default:
        return cap(e.kind);
    }
  })();
  return base + stateCondition(e);
}

/** Range as players read it: "Self", "1", "1–4", "3–10 (+Range)". */
export function rangeText(g: SpellGrade, bonus = 0): string {
  const max = Math.max(g.minRange, g.maxRange + (g.rangeBoostable ? bonus : 0));
  const span = g.minRange === 0 && max === 0 ? 'Self' : g.minRange === max ? `${max}` : `${g.minRange}–${max}`;
  return g.rangeBoostable ? `${span} (boostable)` : span;
}

/** Short facts for the chips: cost, range, conditions, limits, critical chance. */
export function spellFacts(g: SpellGrade, rangeBonus = 0): string[] {
  const facts = [`${g.apCost} AP`, `Range ${rangeText(g, rangeBonus)}`];
  if (g.maxRange > 0) facts.push(g.needsLineOfSight ? 'Line of sight' : 'No line of sight needed');
  if (g.castInLine && g.castInDiagonal) facts.push('In a line or diagonal');
  else if (g.castInLine) facts.push('In a straight line');
  else if (g.castInDiagonal) facts.push('Diagonal only');
  if (g.needsFreeCell) facts.push('Free cell');
  if (g.castsPerTurn > 0) facts.push(`${g.castsPerTurn} per turn`);
  if (g.castsPerTarget > 0) facts.push(`${g.castsPerTarget} per target per turn`);
  if (g.cooldown >= ONCE_PER_FIGHT) facts.push('Once per fight');
  else if (g.cooldown > 1) facts.push(`Every ${g.cooldown} turns`);
  else if (g.cooldown === 1 && g.castsPerTurn !== 1) facts.push('Once per turn');
  if (g.initialCooldown > 0) facts.push(`First cast on turn ${1 + g.initialCooldown}`);
  if (g.criticalEffects.length > 0 && g.criticalChance > 0) facts.push(`Critical ${g.criticalChance}%`);
  return facts;
}
