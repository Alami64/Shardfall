import { describe, expect, it } from 'vitest';
import {
  CLASS_BUILDS,
  PAIR_UNLOCK_LEVELS,
  characteristicFromPoints,
  defaultLoadout,
  heroSetup,
  heroStats,
  loadoutSlots,
  pointCost,
  spellPairs,
} from '../src/index.js';
import { grade, spell } from './fixtures.js';

describe('characteristic points', () => {
  it('cost more as the characteristic grows', () => {
    expect(pointCost('strength', 0)).toBe(1);
    expect(pointCost('strength', 99)).toBe(1);
    expect(pointCost('strength', 100)).toBe(2);
    expect(pointCost('strength', 250)).toBe(3);
    expect(pointCost('strength', 400)).toBe(4);
    expect(pointCost('vitality', 400)).toBe(1);
    expect(pointCost('wisdom', 0)).toBe(3);
  });

  it('buy what the points can pay for', () => {
    expect(characteristicFromPoints('strength', 25, 5)).toBe(30);
    expect(characteristicFromPoints('strength', 295)).toBe(197); // 100 at 1 point, then 97 at 2 (1 point left over)
    expect(characteristicFromPoints('strength', 295, 5)).toBe(200);
    expect(characteristicFromPoints('wisdom', 10)).toBe(3);
  });
});

describe('class builds', () => {
  const vanguard = CLASS_BUILDS.find((b) => b.classId === 'vanguard')!;

  it('put every point into the main characteristic', () => {
    // Level 6: 25 points on top of 5 base.
    expect(heroStats(vanguard, 6)).toMatchObject({ level: 6, strength: 30, agility: 10, initiative: 10, maxHp: 85, ap: 6, mp: 3 });
    expect(heroStats(vanguard, 1)).toMatchObject({ strength: 5, maxHp: 60 });
    expect(heroStats(vanguard, 60)).toMatchObject({ strength: 200, maxHp: 355 });
  });

  it('cover the three launch classes', () => {
    expect(CLASS_BUILDS.map((b) => b.classId)).toEqual(['vanguard', 'longshot', 'mender']);
  });
});

describe('loadouts', () => {
  const g = grade();
  const three = [g, g, g];
  const spells = [
    spell('a1', ...three),
    spell('a2', ...three),
    spell('b1', ...three),
    spell('b2', ...three),
    spell('other', g),
  ].map((s, i) => ({
    ...s,
    classId: i < 4 ? 'vanguard' : 'monster',
    pairId: i < 2 ? 'p1' : i < 4 ? 'p2' : 'o',
    unlockLevel: i < 2 ? 1 : i < 4 ? 10 : 1,
  }));

  it('group a class spells by pair, in unlock order', () => {
    expect(spellPairs([...spells].reverse(), 'vanguard').map((p) => p.map((s) => s.id))).toEqual([
      ['a2', 'a1'],
      ['b2', 'b1'],
    ]);
  });

  it('default to the first spell of each pair', () => {
    expect(defaultLoadout(spells, 'vanguard')).toEqual({ p1: 'a1', p2: 'b1' });
  });

  it('equip one spell per unlocked pair, at the grade the level gives', () => {
    expect(loadoutSlots(spells, 'vanguard', 9, { p1: 'a2', p2: 'b2' })).toEqual([{ spellId: 'a2', grade: 1 }]);
    expect(loadoutSlots(spells, 'vanguard', 30, { p1: 'a2', p2: 'b2' })).toEqual([
      { spellId: 'a2', grade: 2 },
      { spellId: 'b2', grade: 2 },
    ]);
    expect(loadoutSlots(spells, 'vanguard', 60, { p1: 'nope' })).toEqual([
      { spellId: 'a1', grade: 3 },
      { spellId: 'b1', grade: 3 },
    ]);
  });

  it('build a hero setup for a class and level', () => {
    const hero = heroSetup('vanguard', spells, { level: 12, loadout: { p2: 'b2' } });
    expect(hero).toMatchObject({ id: 'vanguard', name: 'Vanguard', team: 'A', controller: 'player' });
    expect(hero.spells).toEqual([
      { spellId: 'a1', grade: 1 },
      { spellId: 'b2', grade: 1 },
    ]);
    expect(hero.stats.strength).toBe(60);
    expect(heroSetup('vanguard', spells, { level: 99 }).stats.level).toBe(60);
    expect(() => heroSetup('warden', spells, { level: 1 })).toThrow();
  });

  it('unlock ten pairs up to the level cap', () => {
    expect(PAIR_UNLOCK_LEVELS).toHaveLength(10);
    expect(PAIR_UNLOCK_LEVELS[0]).toBe(1);
    expect(PAIR_UNLOCK_LEVELS.at(-1)).toBeLessThanOrEqual(60);
  });
});
