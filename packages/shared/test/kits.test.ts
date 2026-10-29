import { describe, expect, it } from 'vitest';
import {
  activeFighter,
  applyDamage,
  castError,
  castSpell,
  effectiveStats,
  endTurn,
  getFighter,
  moveFighter,
  perElement,
  shieldOf,
  spellError,
  type FightState,
  type Rng,
  type SpellCatalogue,
} from '../src/index.js';
import builtSpells from '../../../content/spells/built/spells.json';
import { cell, expectOk, fighter, started, teleport } from './fixtures.js';

/**
 * The launch kits as written in content/spells, at grade 1, played through the
 * engine. These tests pin what each spell does; numbers can move, behaviour
 * should not without a design change.
 */

const { spells } = builtSpells as SpellCatalogue;
const HIGH: Rng = () => 0.99; // top of every roll, no critical hit
const LOW: Rng = () => 0; // bottom of every roll, every removal succeeds

const A_CELL = cell(10, 5);
const slots = spells.map((s) => ({ spellId: s.id, grade: 1 }));

/**
 * `a` (team A, plays first, carries every spell) at (10, 5), its ally `a2`
 * (plays third), and the enemies `b` (plays second) and `b2`, placed as given.
 * Fighters not given a cell are parked out of the way.
 */
function fight(cells: { b?: number; a2?: number; b2?: number } = {}): FightState {
  let state = started(
    [
      fighter('a', 'A', 100, { spells: slots }),
      fighter('b', 'B', 50, { controller: 'ai' }),
      fighter('a2', 'A', 20),
      fighter('b2', 'B', 10, { controller: 'ai' }),
    ],
    1,
    spells,
  );
  state = teleport(state, 'a', A_CELL);
  state = teleport(state, 'b', cells.b ?? cell(20, 0));
  state = teleport(state, 'a2', cells.a2 ?? cell(22, 0));
  return teleport(state, 'b2', cells.b2 ?? cell(24, 0));
}

const cast = (state: FightState, spellId: string, target: number, rng: Rng = HIGH) =>
  expectOk(castSpell(state, 'a', spellId, target, rng));
const at = (state: FightState, id: string) => getFighter(state, id)!;
const pass = (state: FightState, ...ids: string[]) => ids.reduce((s, id) => expectOk(endTurn(s, id)).state, state);
/** Plays turns until `a` starts its next turn. */
const nextTurnOfA = (state: FightState) => pass(state, 'a', 'b', 'a2', 'b2');

it('every launch spell is in the catalogue, three pairs per class', () => {
  for (const classId of ['vanguard', 'longshot', 'mender']) {
    const own = spells.filter((s) => s.classId === classId);
    expect(own).toHaveLength(6);
    expect(new Set(own.map((s) => s.pairId)).size).toBe(3);
  }
});

describe('Vanguard', () => {
  it('Cleave hits in melee only', () => {
    const state = fight({ b: cell(11, 5) });
    expect(at(cast(state, 'cleave', cell(11, 5)).state, 'b').hp).toBe(100 - 15);
    expect(castError(teleport(state, 'b', cell(12, 5)), 'a', 'cleave', cell(12, 5))).toBe('out-of-range');
  });

  it('Gale Cut reaches two cells, three times a turn', () => {
    let state = fight({ b: cell(12, 5) });
    state = cast(state, 'gale_cut', cell(12, 5)).state;
    expect(at(state, 'b').hp).toBe(100 - 13);
    expect(spellError(state, 'a', 'gale_cut')).toBeNull();
  });

  it('Leap jumps to a free cell up to 4 away, then waits 3 turns', () => {
    let state = cast(fight(), 'leap', cell(10, 9)).state;
    expect(at(state, 'a').cell).toBe(cell(10, 9));
    state = nextTurnOfA(state);
    expect(spellError(state, 'a', 'leap')).toBe('on-cooldown');
    state = nextTurnOfA(nextTurnOfA(state));
    expect(spellError(state, 'a', 'leap')).toBeNull();
    expect(castError(state, 'a', 'leap', cell(10, 6))).toBeNull(); // 3 cells from (10, 9)
  });

  it('Charge dashes in line next to the target, then pushes it 1', () => {
    const state = fight({ b: cell(14, 5) });
    const r = cast(state, 'charge', cell(14, 5));
    expect(at(r.state, 'a').cell).toBe(cell(13, 5));
    expect(at(r.state, 'b').cell).toBe(cell(15, 5));
    expect(castError(teleport(state, 'b', cell(12, 6)), 'a', 'charge', cell(12, 6))).toBe('not-in-line');
  });

  it('Rally gives +1 MP to the Vanguard now and to allies in circle 2 on their turn', () => {
    let state = cast(fight({ a2: cell(11, 6), b: cell(10, 6) }), 'rally', A_CELL).state;
    expect(at(state, 'a').mp).toBe(4);
    expect(at(state, 'b').buffs).toEqual([]); // enemies are not rallied
    state = pass(state, 'a', 'b');
    expect(activeFighter(state)!.id).toBe('a2');
    expect(at(state, 'a2').mp).toBe(4);
  });

  it('Brace raises every resistance by 20% until its next turn', () => {
    const state = cast(fight(), 'brace', A_CELL).state;
    expect(effectiveStats(at(state, 'a')).resistPercent).toEqual(perElement(20));
    expect(effectiveStats(at(nextTurnOfA(state), 'a')).resistPercent).toEqual(perElement(0));
  });
});

describe('Longshot', () => {
  it('Piercing Arrow hits the target and the two cells behind it, from 3 cells away', () => {
    const state = fight({ b: cell(13, 5), b2: cell(15, 5) });
    const r = cast(state, 'piercing_arrow', cell(13, 5));
    expect([at(r.state, 'b').hp, at(r.state, 'b2').hp]).toEqual([85, 85]);
    expect(castError(teleport(state, 'b', cell(12, 5)), 'a', 'piercing_arrow', cell(12, 5))).toBe('out-of-range');
  });

  it('Ember Arrow bursts in a circle of 1', () => {
    const r = cast(fight({ b: cell(14, 5), b2: cell(14, 6) }), 'ember_arrow', cell(14, 5));
    expect([at(r.state, 'b').hp, at(r.state, 'b2').hp]).toEqual([87, 87]);
  });

  it('Eagle Eye adds 4 range to boostable spells for three of its turns', () => {
    const far = cell(10, -7); // 12 cells away: Ember Arrow reaches 8, 12 with Eagle Eye
    let state = cast(fight(), 'eagle_eye', A_CELL).state;
    expect(castError(state, 'a', 'ember_arrow', far)).toBeNull();
    state = nextTurnOfA(nextTurnOfA(state));
    expect(castError(state, 'a', 'ember_arrow', far)).toBeNull(); // third turn
    state = nextTurnOfA(state);
    expect(castError(state, 'a', 'ember_arrow', far)).toBe('out-of-range');
  });

  it('Steady Aim gives +15 power but no more movement this turn', () => {
    const r = cast(fight(), 'steady_aim', A_CELL);
    expect(at(r.state, 'a').mp).toBe(0);
    expect(effectiveStats(at(r.state, 'a')).power).toBe(15);
    expect(moveFighter(r.state, 'a', [cell(10, 4)])).toEqual({ ok: false, error: 'not-enough-mp' });
    expect(at(nextTurnOfA(r.state), 'a').mp).toBe(3);
  });

  it('Recoil Shot damages and throws the Longshot 2 cells back', () => {
    const r = cast(fight({ b: cell(13, 5) }), 'recoil_shot', cell(13, 5));
    expect(at(r.state, 'b').hp).toBe(100 - 11);
    expect(at(r.state, 'a').cell).toBe(cell(8, 5));
  });

  it('Pinning Shot takes MP off the target next turn', () => {
    const r = cast(fight({ b: cell(13, 5) }), 'pinning_shot', cell(13, 5), LOW);
    expect(at(pass(r.state, 'a'), 'b').mp).toBe(2); // the lowest roll removes 1 MP
  });
});

describe('Mender', () => {
  it('Mending Light heals an ally, not the Mender itself', () => {
    let state = fight({ a2: cell(12, 5) });
    state = expectOk(applyDamage(state, 'a2', 50)).state;
    expect(at(cast(state, 'mending_light', cell(12, 5)).state, 'a2').hp).toBe(50 + 13);
    expect(castError(state, 'a', 'mending_light', A_CELL)).toBe('out-of-range');
  });

  it('Searing Light burns an enemy', () => {
    expect(at(cast(fight({ b: cell(14, 5) }), 'searing_light', cell(14, 5)).state, 'b').hp).toBe(100 - 12);
  });

  it('Quickening gives an ally +2 AP on its next turn', () => {
    const state = pass(cast(fight({ a2: cell(12, 5) }), 'quickening', cell(12, 5)).state, 'a', 'b');
    expect(activeFighter(state)!.id).toBe('a2');
    expect(at(state, 'a2').ap).toBe(8);
  });

  it('Wellspring heals the Mender and allies in a circle of 1', () => {
    let state = fight({ a2: cell(12, 6) });
    state = expectOk(applyDamage(state, 'a', 30)).state;
    state = expectOk(applyDamage(state, 'a2', 30)).state;
    state = teleport(state, 'a', cell(12, 4)); // a2 is 2 cells from a, both within 1 of (12, 5)
    const r = cast(state, 'wellspring', cell(12, 5));
    expect([at(r.state, 'a').hp, at(r.state, 'a2').hp]).toEqual([80, 80]);
  });

  it('Rebirth revives the last fallen ally at 30% HP, once per fight', () => {
    let state = expectOk(applyDamage(fight(), 'a2', 1000)).state;
    const r = cast(state, 'rebirth', cell(11, 5));
    expect(at(r.state, 'a2')).toMatchObject({ status: 'alive', cell: cell(11, 5), hp: 30 });
    state = r.state;
    for (let i = 0; i < 5; i++) state = nextTurnOfA(state);
    expect(spellError(state, 'a', 'rebirth')).toBe('on-cooldown');
  });

  it('Sanctuary shields an ally for 15% of its max HP', () => {
    const state = cast(fight({ a2: cell(12, 5) }), 'sanctuary', cell(12, 5)).state;
    expect(shieldOf(at(state, 'a2'))).toBe(15);
    expect(shieldOf(at(state, 'a'))).toBe(0);
  });
});
