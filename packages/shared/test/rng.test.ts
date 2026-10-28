import { describe, expect, it } from 'vitest';
import { characterAp, characterMaxHp, createRng, randomInt, shuffle } from '../src/index.js';

describe('createRng', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('gives different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const same = Array.from({ length: 20 }, () => a() === b()).filter(Boolean).length;
    expect(same).toBeLessThan(20);
  });

  it('stays in [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 10_000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('randomInt', () => {
  it('covers both bounds and nothing outside them', () => {
    const rng = createRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(randomInt(rng, 2, 5));
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
  });

  it('maps the extremes of the source onto the bounds', () => {
    expect(randomInt(() => 0, 10, 20)).toBe(10);
    expect(randomInt(() => 0.999999, 10, 20)).toBe(20);
  });
});

describe('shuffle', () => {
  it('returns a permutation and leaves the input alone', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffle(createRng(9), input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort()).toEqual(input);
  });
});

describe('character stats', () => {
  it('computes max HP as 55 + 5 per level + Vitality', () => {
    expect(characterMaxHp(1, 0)).toBe(60);
    expect(characterMaxHp(200, 150)).toBe(1205);
  });

  it('grants the 7th AP at level 100', () => {
    expect(characterAp(1)).toBe(6);
    expect(characterAp(99)).toBe(6);
    expect(characterAp(100)).toBe(7);
  });
});
