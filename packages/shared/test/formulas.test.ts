import { describe, expect, it } from 'vitest';
import {
  characteristicFor,
  directDamage,
  fighterStats,
  healAmount,
  perElement,
  pointsAfterTackle,
  removalChance,
  resistedDamage,
  tackleEscape,
} from '../src/index.js';

describe('characteristicFor', () => {
  it('maps each element to its characteristic', () => {
    const s = fighterStats({ strength: 1, intelligence: 2, chance: 3, agility: 4 });
    expect(characteristicFor(s, 'neutral')).toBe(1);
    expect(characteristicFor(s, 'earth')).toBe(1);
    expect(characteristicFor(s, 'fire')).toBe(2);
    expect(characteristicFor(s, 'water')).toBe(3);
    expect(characteristicFor(s, 'air')).toBe(4);
  });
});

describe('directDamage', () => {
  const attacker = fighterStats({ strength: 50, power: 10, damage: { ...perElement(), earth: 5 }, criticalDamage: 8 });

  it('is floor(base × (100 + characteristic + power) / 100) + flat damage', () => {
    expect(directDamage(20, attacker, 'earth', false)).toBe(37); // floor(20 × 1.6) + 5
    expect(directDamage(13, attacker, 'earth', false)).toBe(25); // floor(20.8) + 5
    expect(directDamage(20, attacker, 'fire', false)).toBe(22); // Intelligence 0, power still counts: floor(20 × 1.1)
  });

  it('adds Critical Damage on a critical hit', () => {
    expect(directDamage(20, attacker, 'earth', true)).toBe(45);
  });

  it('never goes below 0', () => {
    const weak = fighterStats({ strength: -300, damage: { ...perElement(), earth: -10 } });
    expect(directDamage(20, weak, 'earth', false)).toBe(0);
  });
});

describe('resistedDamage', () => {
  const defender = (percent: number, flat: number) =>
    fighterStats({ resistPercent: { ...perElement(), earth: percent }, resistFlat: { ...perElement(), earth: flat } });

  it('is max(0, floor(dmg × (100 − res%) / 100) − flat res)', () => {
    expect(resistedDamage(100, defender(30, 5), 'earth', false)).toBe(65);
    expect(resistedDamage(33, defender(25, 0), 'earth', false)).toBe(24); // floor(24.75)
    expect(resistedDamage(100, defender(30, 5), 'fire', false)).toBe(100); // other element: no resistance
    expect(resistedDamage(10, defender(0, 20), 'earth', false)).toBe(0);
  });

  it('caps players at 50%, not monsters', () => {
    expect(resistedDamage(100, defender(80, 0), 'earth', true)).toBe(50);
    expect(resistedDamage(100, defender(80, 0), 'earth', false)).toBe(20);
  });

  it('lets a negative resistance amplify damage', () => {
    expect(resistedDamage(100, defender(-20, 0), 'earth', false)).toBe(120);
  });
});

describe('healAmount', () => {
  it('is floor(base × (100 + Intelligence) / 100) + Heals', () => {
    expect(healAmount(30, fighterStats({ intelligence: 100, heals: 7 }))).toBe(67);
    expect(healAmount(15, fighterStats({ intelligence: 10 }))).toBe(16); // floor(16.5)
  });
});

describe('tackle', () => {
  it('computes the escape share as (dodge + 2) / (2 × (lock + 2))', () => {
    expect(tackleEscape(0, 0)).toBe(0.5);
    expect(tackleEscape(10, 4)).toBe(1);
    expect(tackleEscape(4, 10)).toBe(0.25);
    expect(tackleEscape(-5, -5)).toBe(0.5); // negative stats count as 0
  });

  it('keeps that share of the points, rounded down, and everything at 1 or more', () => {
    expect(pointsAfterTackle(3, 0.5)).toBe(1);
    expect(pointsAfterTackle(6, 0.5)).toBe(3);
    expect(pointsAfterTackle(5, 0.4)).toBe(2);
    expect(pointsAfterTackle(3, 1)).toBe(3);
    expect(pointsAfterTackle(3, 1.5)).toBe(3);
  });
});

describe('removalChance', () => {
  it('is 0.5 × removal / parry × current / max', () => {
    expect(removalChance(10, 10, 6, 6)).toBe(0.5);
    expect(removalChance(20, 10, 3, 6)).toBe(0.5);
    expect(removalChance(12, 10, 6, 6)).toBeCloseTo(0.6);
  });

  it('stays between 10% and 90%', () => {
    expect(removalChance(100, 10, 6, 6)).toBe(0.9);
    expect(removalChance(0, 10, 6, 6)).toBe(0.1);
    expect(removalChance(10, 0, 6, 6)).toBe(0.9); // parry below 1 counts as 1
    expect(removalChance(0, 0, 6, 6)).toBe(0.5); // removal below 1 too: no stats on either side is 50%
    expect(removalChance(0, 0, 3, 6)).toBe(0.25);
  });

  it('is 0 with no points left', () => {
    expect(removalChance(10, 10, 0, 6)).toBe(0);
  });
});
