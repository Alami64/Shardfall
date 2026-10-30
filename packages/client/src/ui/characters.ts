/** What the bar and the windows show about a hero, whether exploring or fighting. */
import {
  effectiveStats,
  spellGradeForLevel,
  spellGradeOf,
  spellPairs,
  type FightState,
  type Fighter,
  type FighterSetup,
  type FighterStats,
  type SpellGrade,
  type SpellSlot,
} from '@shardfall/shared';
import { spells } from '../assets';
import { buffLabel } from '../fight/describe';

export interface SpellView {
  id: string;
  grade: number;
  data: SpellGrade;
  /** Why it cannot be cast right now (in a fight, on this hero's turn), or null. */
  blocked: string | null;
  /** Turns until it can be cast again, 0 when ready. */
  cooldown: number;
}

/** A spell pair of a hero's class, with the side on the bar (exploring only). */
export interface PairView {
  pairId: string;
  unlockLevel: number;
  unlocked: boolean;
  /** The side on the bar. */
  equipped: string;
  /** Both sides, at the grade the hero's level gives (grade 1 while locked). */
  options: SpellView[];
}

export interface CharacterView {
  id: string;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  ap: number;
  mp: number;
  /** Stats on entering the fight (gear included), and with the current buffs. */
  base: FighterStats;
  stats: FighterStats;
  buffs: string[];
  alive: boolean;
  /** The spells on the bar, in pair order. */
  spells: SpellView[];
  /** Every pair of the class, so the loadout can change; empty in a fight. */
  pairs: PairView[];
}

const gradeOf = (slot: SpellSlot) => spells.find((s) => s.id === slot.spellId)?.grades[slot.grade - 1];

/** A hero outside a fight: full HP and points, no buffs. */
export function viewOfSetup(s: FighterSetup): CharacterView {
  return {
    id: s.id,
    name: s.name,
    level: s.stats.level,
    hp: s.hp ?? s.stats.maxHp,
    maxHp: s.stats.maxHp,
    ap: s.stats.ap,
    mp: s.stats.mp,
    base: s.stats,
    stats: s.stats,
    buffs: [],
    alive: true,
    spells: (s.spells ?? []).flatMap((slot) => {
      const data = gradeOf(slot);
      return data ? [{ id: slot.spellId, grade: slot.grade, data, blocked: null, cooldown: 0 }] : [];
    }),
    pairs: pairsOf(s),
  };
}

function pairsOf(s: FighterSetup): PairView[] {
  const onBar = new Set((s.spells ?? []).map((slot) => slot.spellId));
  return spellPairs(spells, s.id).map((pair) => {
    const first = pair[0]!;
    return {
      pairId: first.pairId,
      unlockLevel: first.unlockLevel,
      unlocked: s.stats.level >= first.unlockLevel,
      equipped: (pair.find((x) => onBar.has(x.id)) ?? first).id,
      options: pair.map((x) => {
        const grade = Math.max(1, spellGradeForLevel(x, s.stats.level));
        return { id: x.id, grade, data: x.grades[grade - 1]!, blocked: null, cooldown: 0 };
      }),
    };
  });
}

/** A fighter in a fight; `blocked` says why each spell cannot be cast now (from spellError). */
export function viewOfFighter(state: FightState, f: Fighter, blocked: (spellId: string) => string | null): CharacterView {
  return {
    id: f.id,
    name: f.name,
    level: f.stats.level,
    hp: f.hp,
    maxHp: f.stats.maxHp,
    ap: f.ap,
    mp: f.mp,
    base: f.stats,
    stats: effectiveStats(f),
    buffs: [...new Set(f.buffs.map(buffLabel))],
    alive: f.status === 'alive',
    spells: f.spells.flatMap((slot) => {
      const data = spellGradeOf(state, f, slot.spellId);
      if (!data) return [];
      const usage = f.spellUsage[slot.spellId];
      // During a turn `turns` is the current one; between turns, count from the next.
      const cooldown = usage ? Math.max(0, usage.castableFromTurn - Math.max(1, f.turns)) : 0;
      return [{ id: slot.spellId, grade: slot.grade, data, blocked: blocked(slot.spellId), cooldown }];
    }),
    pairs: [],
  };
}
