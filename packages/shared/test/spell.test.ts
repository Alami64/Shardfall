import { describe, expect, it } from 'vitest';
import {
  castError,
  castSpell,
  castableCells,
  createFight,
  createRng,
  endTurn,
  getFighter,
  joinFight,
  spellError,
  spellGradeForLevel,
  spellRange,
  spellRangeCells,
  type FightState,
  type Spell,
  type SpellCatalogue,
  type SpellGrade,
} from '../src/index.js';
import builtSpells from '../../../content/spells/built/spells.json';
import { MAP, ROCK, cell, create, expectOk, fighter, grade, spell, started, teleport } from './fixtures.js';

const A_CELL = cell(10, 5);
const B_CELL = cell(12, 5);

/**
 * `a` (team A, plays first) at (10, 5) and `b` (team B) at (12, 5), both
 * carrying every given spell at grade 1. `a` has `range` bonus range.
 */
function duel(spells: Spell[], range = 0): FightState {
  const slots = spells.map((s) => ({ spellId: s.id, grade: 1 }));
  const a = fighter('a', 'A', 100, { spells: slots, stats: { range } });
  const state = started([a, fighter('b', 'B', 50, { spells: slots })], 1, spells);
  return teleport(teleport(state, 'a', A_CELL), 'b', B_CELL);
}

/** Ends turns until it is `a`'s turn again. */
const nextTurnOfA = (state: FightState) => expectOk(endTurn(expectOk(endTurn(state, 'a')).state, 'b')).state;

const cast = (state: FightState, spellId: string, target: number) =>
  expectOk(castSpell(state, 'a', spellId, target, createRng(1))).state;

const only = (g: Partial<SpellGrade>) => [spell('s', grade(g))];

describe('spell grades by level', () => {
  const s = (unlockLevel: number, grades = 3): Spell => ({
    ...spell('s', ...Array.from({ length: grades }, () => grade())),
    unlockLevel,
  });

  it('upgrades 50 and 100 levels after unlock', () => {
    expect(spellGradeForLevel(s(1), 1)).toBe(1);
    expect(spellGradeForLevel(s(1), 50)).toBe(1);
    expect(spellGradeForLevel(s(1), 51)).toBe(2);
    expect(spellGradeForLevel(s(1), 101)).toBe(3);
  });

  it('is locked below the unlock level and caps upgrades at level 200', () => {
    expect(spellGradeForLevel(s(150), 149)).toBe(0);
    expect(spellGradeForLevel(s(150), 199)).toBe(1);
    expect(spellGradeForLevel(s(150), 200)).toBe(3);
  });

  it('never goes past the grades a spell has', () => {
    expect(spellGradeForLevel(s(1, 2), 200)).toBe(2);
  });
});

describe('spell loadout', () => {
  const catalogue = [spell('s', grade(), grade())];
  const empty = () => expectOk(createFight(MAP, [], createRng(1), { spells: catalogue })).state;

  it('accepts spells from the catalogue at an existing grade', () => {
    const r = joinFight(empty(), fighter('a', 'A', 0, { spells: [{ spellId: 's', grade: 2 }] }), createRng(1));
    expect(expectOk(r).state.fighters[0]!.spells).toEqual([{ spellId: 's', grade: 2 }]);
  });

  it('refuses unknown spells, missing grades and duplicates', () => {
    for (const spells of [
      [{ spellId: 'nope', grade: 1 }],
      [{ spellId: 's', grade: 3 }],
      [{ spellId: 's', grade: 0 }],
      [
        { spellId: 's', grade: 1 },
        { spellId: 's', grade: 2 },
      ],
    ]) {
      expect(joinFight(empty(), fighter('a', 'A', 0, { spells }), createRng(1))).toEqual({
        ok: false,
        error: 'unknown-spell',
      });
    }
  });
});

describe('castSpell', () => {
  it('spends AP and reports the cast', () => {
    const state = duel(only({ apCost: 4 }));
    const r = expectOk(castSpell(state, 'a', 's', B_CELL, createRng(1)));
    expect(getFighter(r.state, 'a')!.ap).toBe(2);
    expect(r.events).toEqual([
      { type: 'spellCast', fighterId: 'a', spellId: 's', grade: 1, cell: B_CELL, critical: false },
    ]);
    expect(castSpell(r.state, 'a', 's', B_CELL, createRng(1))).toEqual({ ok: false, error: 'not-enough-ap' });
  });

  it('only works for the active fighter, with a spell on its bar', () => {
    const state = duel(only({}));
    expect(castSpell(state, 'b', 's', A_CELL, createRng(1))).toEqual({ ok: false, error: 'not-your-turn' });
    expect(castSpell(state, 'a', 'other', B_CELL, createRng(1))).toEqual({ ok: false, error: 'unknown-spell' });
    expect(castSpell(create([fighter('a', 'A', 0)]), 'a', 's', B_CELL, createRng(1))).toEqual({
      ok: false,
      error: 'wrong-phase',
    });
  });

  it('never changes the state it was given', () => {
    const state = duel(only({ cooldown: 2, castsPerTarget: 1 }));
    const snapshot = JSON.stringify({ ...state, map: null });
    castSpell(state, 'a', 's', B_CELL, createRng(1));
    expect(JSON.stringify({ ...state, map: null })).toBe(snapshot);
  });
});

describe('targeting', () => {
  it('needs a walkable cell on the map', () => {
    const state = teleport(duel(only({})), 'a', cell(15, 3));
    expect(castError(state, 'a', 's', ROCK)).toBe('invalid-target');
    expect(castError(state, 'a', 's', -1)).toBe('invalid-target');
    expect(castError(state, 'a', 's', 10_000)).toBe('invalid-target');
  });

  it('respects min and max range', () => {
    const state = duel(only({ minRange: 2, maxRange: 3 }));
    expect(castError(state, 'a', 's', cell(11, 5))).toBe('out-of-range');
    expect(castError(state, 'a', 's', B_CELL)).toBeNull();
    expect(castError(state, 'a', 's', cell(10, 8))).toBeNull();
    expect(castError(state, 'a', 's', cell(10, 9))).toBe('out-of-range');
  });

  it('lets range 0 target the caster itself', () => {
    const state = duel(only({ minRange: 0, maxRange: 0 }));
    expect(castError(state, 'a', 's', A_CELL)).toBeNull();
    expect(castError(state, 'a', 's', cell(11, 5))).toBe('out-of-range');
  });

  it('adds bonus range only to boostable spells, never below the min', () => {
    const boostable = spell('boost', grade({ minRange: 1, maxRange: 3, rangeBoostable: true }));
    const fixed = spell('fixed', grade({ minRange: 1, maxRange: 3 }));
    const state = duel([boostable, fixed], 2);
    expect(castError(state, 'a', 'boost', cell(10, 10))).toBeNull(); // 5 cells away
    expect(castError(state, 'a', 'fixed', cell(10, 10))).toBe('out-of-range');

    const a = getFighter(duel([boostable], -10), 'a')!;
    expect(spellRange(a, boostable.grades[0]!)).toEqual({ min: 1, max: 1 });
  });

  it('can require a grid line, a grid diagonal, or either', () => {
    const line = duel(only({ castInLine: true }));
    expect(castError(line, 'a', 's', cell(10, 8))).toBeNull();
    expect(castError(line, 'a', 's', cell(11, 7))).toBe('not-in-line');

    const diagonal = duel(only({ castInDiagonal: true }));
    expect(castError(diagonal, 'a', 's', cell(12, 7))).toBeNull();
    expect(castError(diagonal, 'a', 's', cell(10, 8))).toBe('not-in-line');
    expect(castError(diagonal, 'a', 's', cell(11, 7))).toBe('not-in-line');

    const both = duel(only({ castInLine: true, castInDiagonal: true }));
    expect(castError(both, 'a', 's', cell(10, 8))).toBeNull();
    expect(castError(both, 'a', 's', cell(12, 7))).toBeNull();
    expect(castError(both, 'a', 's', cell(11, 7))).toBe('not-in-line');
  });

  it('can require a free cell', () => {
    const state = duel(only({ needsFreeCell: true }));
    expect(castError(state, 'a', 's', B_CELL)).toBe('cell-occupied');
    expect(castError(state, 'a', 's', cell(11, 5))).toBeNull();
  });

  it('is blocked by fighters and obstacles in the way, not on the target', () => {
    const state = duel(only({}));
    expect(castError(state, 'a', 's', B_CELL)).toBeNull();
    expect(castError(state, 'a', 's', cell(14, 5))).toBe('no-line-of-sight'); // b stands in the way
    const behindRock = teleport(state, 'a', cell(15, 3));
    expect(castError(behindRock, 'a', 's', cell(15, -1))).toBe('no-line-of-sight');

    const ignoresLos = duel(only({ needsLineOfSight: false }));
    expect(castError(ignoresLos, 'a', 's', cell(14, 5))).toBeNull();
  });
});

describe('cooldowns and cast limits', () => {
  it('waits `cooldown` turns between casts', () => {
    let state = cast(duel(only({ apCost: 1, cooldown: 2 })), 's', B_CELL);
    expect(castError(state, 'a', 's', B_CELL)).toBe('on-cooldown');
    state = nextTurnOfA(state);
    expect(castError(state, 'a', 's', B_CELL)).toBe('on-cooldown');
    state = nextTurnOfA(state);
    expect(castError(state, 'a', 's', B_CELL)).toBeNull();
  });

  it('makes cooldown 1 mean once per turn', () => {
    let state = cast(duel(only({ apCost: 1, cooldown: 1 })), 's', B_CELL);
    expect(castError(state, 'a', 's', B_CELL)).toBe('on-cooldown');
    state = nextTurnOfA(state);
    expect(castError(state, 'a', 's', B_CELL)).toBeNull();
  });

  it('holds the first cast back by the initial cooldown', () => {
    let state = duel(only({ initialCooldown: 1 }));
    expect(spellError(state, 'a', 's')).toBe('on-cooldown');
    state = nextTurnOfA(state);
    expect(spellError(state, 'a', 's')).toBeNull();
  });

  it('caps casts per turn', () => {
    let state = duel(only({ apCost: 1, castsPerTurn: 2 }));
    state = cast(cast(state, 's', B_CELL), 's', cell(11, 5));
    expect(spellError(state, 'a', 's')).toBe('cast-limit');
    expect(spellError(nextTurnOfA(state), 'a', 's')).toBeNull();
  });

  it('caps casts per target fighter, not per cell', () => {
    let state = cast(duel(only({ apCost: 1, castsPerTarget: 1 })), 's', B_CELL);
    expect(castError(state, 'a', 's', B_CELL)).toBe('target-limit');
    expect(castError(state, 'a', 's', cell(11, 5))).toBeNull(); // empty cell
    const bMoved = teleport(state, 'b', cell(10, 7));
    expect(castError(bMoved, 'a', 's', cell(10, 7))).toBe('target-limit');
    expect(castError(nextTurnOfA(state), 'a', 's', B_CELL)).toBeNull();
  });
});

describe('range preview', () => {
  it('lists the cells in range, and the castable ones among them', () => {
    const state = duel(only({ minRange: 1, maxRange: 4 }));
    const range = spellRangeCells(state, 'a', 's');
    expect(range).toHaveLength(4 + 8 + 12 + 16);
    const castable = castableCells(state, 'a', 's');
    expect(castable.every((c) => range.includes(c))).toBe(true);
    expect(castable).toContain(B_CELL);
    expect(castable).not.toContain(cell(13, 5)); // behind b
    expect(castable).not.toContain(cell(14, 5));
    expect(range).toContain(cell(14, 5));
  });

  it('offers nothing when the spell cannot be cast at all', () => {
    const state = duel(only({ apCost: 7 }));
    expect(castableCells(state, 'a', 's')).toEqual([]);
    expect(castableCells(state, 'b', 's')).toEqual([]);
  });
});

describe('content spells', () => {
  const { spells } = builtSpells as SpellCatalogue;

  it('loads every built spell into a fight, at every grade', () => {
    expect(spells.length).toBeGreaterThan(0);
    for (const s of spells) {
      for (let g = 1; g <= s.grades.length; g++) {
        const slots = [{ spellId: s.id, grade: g }];
        const r = createFight(MAP, [fighter('a', 'A', 100, { spells: slots })], createRng(1), { spells });
        expect(r.ok, `${s.id} grade ${g}`).toBe(true);
      }
    }
  });

  it('can cast every built spell at its minimum range', () => {
    for (const s of spells) {
      const { minRange } = s.grades[0]!;
      // A target down the x axis suits every content spell so far (none is diagonal-only); range 0 is the caster.
      const target = minRange === 0 ? A_CELL : cell(10 + minRange, 5);
      const state = minRange === 0 ? duel([s]) : teleport(duel([s]), 'b', target);
      expect(castError(state, 'a', s.id, target), s.id).toBeNull();
    }
  });
});
