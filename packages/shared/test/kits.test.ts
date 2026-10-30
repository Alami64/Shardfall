import { describe, expect, it } from 'vitest';
import {
  activeFighter,
  applyDamage,
  castError,
  castSpell,
  effectiveStats,
  endTurn,
  getFighter,
  hasState,
  moveFighter,
  PAIR_UNLOCK_LEVELS,
  perElement,
  shieldOf,
  spellError,
  spellPairs,
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

it('every launch class has 20 spells in 10 pairs, one pair per unlock level', () => {
  for (const classId of ['vanguard', 'longshot', 'mender']) {
    const pairs = spellPairs(spells, classId);
    expect(pairs.map((p) => p.length)).toEqual(Array(10).fill(2));
    expect(pairs.map((p) => p[0]!.unlockLevel)).toEqual([...PAIR_UNLOCK_LEVELS]);
  }
});

const dot = (state: FightState, id: string) => at(state, id).buffs.find((b) => b.kind === 'dot');
const hurtBy = (state: FightState, id: string, amount: number) => expectOk(applyDamage(state, id, amount)).state;
/** Gives `a` plenty of AP, to reach a spell's cast limits. */
const flush = (state: FightState) => ({ ...state, fighters: state.fighters.map((f) => (f.id === 'a' ? { ...f, ap: 20 } : f)) });

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

describe('Vanguard, pairs 4-10', () => {
  it('Sunder hits hard in melee, once per turn', () => {
    const r = cast(flush(fight({ b: cell(11, 5) })), 'sunder', cell(11, 5));
    expect(at(r.state, 'b').hp).toBe(100 - 22);
    expect(spellError(r.state, 'a', 'sunder')).toBe('cast-limit');
  });

  it('Whirlwind hits every enemy next to the Vanguard, not allies', () => {
    const r = cast(fight({ b: cell(11, 5), b2: cell(10, 6), a2: cell(9, 5) }), 'whirlwind', A_CELL);
    expect([at(r.state, 'b').hp, at(r.state, 'b2').hp, at(r.state, 'a2').hp]).toEqual([86, 86, 100]);
  });

  it('Hook Chain pulls an enemy in line 3 cells closer', () => {
    const state = fight({ b: cell(14, 5) });
    expect(at(cast(state, 'hook_chain', cell(14, 5)).state, 'b').cell).toBe(cell(11, 5));
    expect(castError(teleport(state, 'b', cell(13, 6)), 'a', 'hook_chain', cell(13, 6))).toBe('not-in-line');
  });

  it('Shoulder Bash hits and pushes the target 2 cells', () => {
    const r = cast(fight({ b: cell(11, 5) }), 'shoulder_bash', cell(11, 5));
    expect(at(r.state, 'b')).toMatchObject({ hp: 100 - 9, cell: cell(13, 5) });
  });

  it('Rend makes the target bleed at the start of its next three turns', () => {
    const r = cast(fight({ b: cell(11, 5) }), 'rend', cell(11, 5));
    expect(at(r.state, 'b').hp).toBe(100);
    expect(dot(r.state, 'b')).toMatchObject({ element: 'earth', value: 8, remaining: 3 });
    expect(at(pass(r.state, 'a'), 'b').hp).toBe(92);
  });

  it('Bloodletting heals the Vanguard for half the damage', () => {
    const r = cast(hurtBy(fight({ b: cell(11, 5) }), 'a', 30), 'bloodletting', cell(11, 5));
    expect([at(r.state, 'b').hp, at(r.state, 'a').hp]).toEqual([87, 76]);
  });

  it('War Cry gives +25 power to the Vanguard and allies within 2 cells for 2 turns', () => {
    const state = cast(fight({ a2: cell(11, 6), b: cell(10, 6) }), 'war_cry', A_CELL).state;
    expect([effectiveStats(at(state, 'a')).power, effectiveStats(at(state, 'a2')).power]).toEqual([25, 25]);
    expect(at(state, 'b').buffs).toEqual([]);
  });

  it('Bulwark shields the Vanguard for 20% of its max HP', () => {
    expect(shieldOf(at(cast(fight(), 'bulwark', A_CELL).state, 'a'))).toBe(20);
  });

  it('Vault swaps places with any fighter up to 4 cells away', () => {
    const r = cast(fight({ b: cell(12, 5) }), 'vault', cell(12, 5));
    expect([at(r.state, 'a').cell, at(r.state, 'b').cell]).toEqual([cell(12, 5), A_CELL]);
    expect(spellError(nextTurnOfA(r.state), 'a', 'vault')).toBe('on-cooldown');
  });

  it('Onslaught gives +2 MP at once', () => {
    expect(at(cast(fight(), 'onslaught', A_CELL).state, 'a').mp).toBe(5);
  });

  it('Earthsplitter hits a line of three cells, cast in line', () => {
    const state = fight({ b: cell(11, 5), b2: cell(13, 5) });
    const r = cast(state, 'earthsplitter', cell(11, 5));
    expect([at(r.state, 'b').hp, at(r.state, 'b2').hp]).toEqual([78, 78]);
    expect(castError(state, 'a', 'earthsplitter', cell(11, 6))).toBe('not-in-line');
  });

  it('Tempest Blade hits enemies in a cross around the target', () => {
    const r = cast(fight({ b: cell(12, 5), b2: cell(12, 6), a2: cell(13, 5) }), 'tempest_blade', cell(12, 5));
    expect([at(r.state, 'b').hp, at(r.state, 'b2').hp, at(r.state, 'a2').hp]).toEqual([82, 82, 100]);
  });

  it('Unbreakable gives +30% resistances and roots the Vanguard', () => {
    const state = cast(fight(), 'unbreakable', A_CELL).state;
    expect(effectiveStats(at(state, 'a')).resistPercent).toEqual(perElement(30));
    expect(hasState(at(state, 'a'), 'rooted')).toBe(true);
  });

  it('Berserk trades 10% resistances for +40 power', () => {
    const stats = effectiveStats(at(cast(fight(), 'berserk', A_CELL).state, 'a'));
    expect([stats.power, stats.resistPercent.earth]).toEqual([40, -10]);
  });
});

describe('Longshot, pairs 4-10', () => {
  it('Firebrand Arrow hits, then burns for 2 turns', () => {
    const r = cast(fight({ b: cell(14, 5) }), 'firebrand_arrow', cell(14, 5));
    expect(at(r.state, 'b').hp).toBe(92);
    expect(dot(r.state, 'b')).toMatchObject({ element: 'fire', value: 6, remaining: 2 });
    expect(at(pass(r.state, 'a'), 'b').hp).toBe(86);
  });

  it('Twin Shot fires twice a turn', () => {
    let state = cast(flush(fight({ b: cell(13, 5) })), 'twin_shot', cell(13, 5)).state;
    state = cast(state, 'twin_shot', cell(13, 5)).state;
    expect(at(state, 'b').hp).toBe(80);
    expect(spellError(state, 'a', 'twin_shot')).toBe('cast-limit');
  });

  it("Hunter's Mark lowers an enemy's resistances by 15% for 2 turns", () => {
    const state = cast(fight({ b: cell(14, 5) }), 'hunters_mark', cell(14, 5)).state;
    expect(effectiveStats(at(state, 'b')).resistPercent).toEqual(perElement(-15));
  });

  it('Blinding Shot hits and takes 3 range off the target', () => {
    const state = cast(fight({ b: cell(13, 5) }), 'blinding_shot', cell(13, 5)).state;
    expect(at(state, 'b').hp).toBe(92);
    expect(effectiveStats(at(state, 'b')).range).toBe(-3);
  });

  it('Sidestep teleports to a free cell up to 3 away', () => {
    const state = cast(fight(), 'sidestep', cell(10, 8)).state;
    expect(at(state, 'a').cell).toBe(cell(10, 8));
    expect(castError(fight({ b: cell(11, 5) }), 'a', 'sidestep', cell(11, 5))).toBe('cell-occupied');
  });

  it('Fall Back throws the Longshot 3 cells away from the target cell', () => {
    expect(at(cast(fight({ b: cell(11, 5) }), 'fall_back', cell(11, 5)).state, 'a').cell).toBe(cell(7, 5));
  });

  it('Longbow Draw hits hard from 6 to 12 cells, in line', () => {
    const state = fight({ b: cell(16, 5) });
    expect(at(cast(state, 'longbow_draw', cell(16, 5)).state, 'b').hp).toBe(100 - 26);
    expect(castError(teleport(state, 'b', cell(15, 5)), 'a', 'longbow_draw', cell(15, 5))).toBe('out-of-range');
  });

  it('Scatter Shot hits a cone widening behind the target', () => {
    const r = cast(fight({ b: cell(12, 5), b2: cell(14, 7) }), 'scatter_shot', cell(12, 5));
    expect([at(r.state, 'b').hp, at(r.state, 'b2').hp]).toEqual([85, 85]);
  });

  it('Crippling Arrow hits and takes AP off the target next turn', () => {
    const state = cast(fight({ b: cell(13, 5) }), 'crippling_arrow', cell(13, 5)).state;
    expect(at(state, 'b').hp).toBe(91);
    expect(at(pass(cast(fight({ b: cell(13, 5) }), 'crippling_arrow', cell(13, 5), LOW).state, 'a'), 'b').ap).toBe(5);
  });

  it('Tar Arrow takes MP off every enemy in a circle of 1', () => {
    const state = pass(cast(fight({ b: cell(14, 5), b2: cell(15, 5) }), 'tar_arrow', cell(14, 5), LOW).state, 'a');
    expect(at(state, 'b').mp).toBe(2);
    expect(at(state, 'b2').buffs).toMatchObject([{ kind: 'stat', stat: 'mp', value: -1 }]);
  });

  it('Burning Rain sets every enemy in a circle of 1 burning for 3 turns', () => {
    const state = cast(fight({ b: cell(14, 5), b2: cell(14, 6) }), 'burning_rain', cell(14, 5)).state;
    expect([dot(state, 'b'), dot(state, 'b2')]).toMatchObject([
      { value: 9, remaining: 3 },
      { value: 9, remaining: 3 },
    ]);
  });

  it('Storm Arrow hits the target and the four cells behind it', () => {
    const r = cast(fight({ b: cell(13, 5), b2: cell(17, 5) }), 'storm_arrow', cell(13, 5));
    expect([at(r.state, 'b').hp, at(r.state, 'b2').hp]).toEqual([81, 81]);
  });

  it('Deadeye gives +30 power and +15 critical chance', () => {
    const stats = effectiveStats(at(cast(fight(), 'deadeye', A_CELL).state, 'a'));
    expect([stats.power, stats.criticalChance]).toEqual([30, 15]);
  });

  it("Hawk's Patience gives +2 MP now and +20% resistances", () => {
    const a = at(cast(fight(), 'hawks_patience', A_CELL).state, 'a');
    expect([a.mp, effectiveStats(a).resistPercent.fire]).toEqual([5, 20]);
  });
});

describe('Mender, pairs 4-10', () => {
  it('Tidal Lance hits the target and the cell behind it', () => {
    const r = cast(fight({ b: cell(12, 5), b2: cell(13, 5) }), 'tidal_lance', cell(12, 5));
    expect([at(r.state, 'b').hp, at(r.state, 'b2').hp]).toEqual([85, 85]);
  });

  it('Smoulder burns the target for 3 turns', () => {
    const r = cast(fight({ b: cell(13, 5) }), 'smoulder', cell(13, 5));
    expect(dot(r.state, 'b')).toMatchObject({ element: 'fire', value: 7, remaining: 3 });
    expect(at(pass(r.state, 'a'), 'b').hp).toBe(93);
  });

  it('Renewal heals a lot, the Mender included', () => {
    expect(at(cast(hurtBy(fight(), 'a', 50), 'renewal', A_CELL).state, 'a').hp).toBe(74);
  });

  it('Soothing Mist heals in a cross, twice a turn', () => {
    let state = flush(hurtBy(fight({ a2: cell(12, 6) }), 'a2', 30));
    state = cast(cast(state, 'soothing_mist', cell(12, 5)).state, 'soothing_mist', cell(12, 5)).state;
    expect(at(state, 'a2').hp).toBe(70 + 18);
    expect(spellError(state, 'a', 'soothing_mist')).toBe('cast-limit');
  });

  it('Fleetfoot Blessing gives an ally +2 MP on its turn', () => {
    const state = pass(cast(fight({ a2: cell(12, 5) }), 'fleetfoot_blessing', cell(12, 5)).state, 'a', 'b');
    expect(activeFighter(state)!.id).toBe('a2');
    expect(at(state, 'a2').mp).toBe(5);
  });

  it('Warding Hymn gives +15% resistances to the Mender and allies within 2 cells', () => {
    const state = cast(fight({ a2: cell(11, 6) }), 'warding_hymn', A_CELL).state;
    expect([effectiveStats(at(state, 'a')).resistPercent.air, effectiveStats(at(state, 'a2')).resistPercent.air]).toEqual([15, 15]);
  });

  it('Leech Tide heals the Mender for half the damage', () => {
    const r = cast(hurtBy(fight({ b: cell(13, 5) }), 'a', 30), 'leech_tide', cell(13, 5));
    expect([at(r.state, 'b').hp, at(r.state, 'a').hp]).toEqual([86, 77]);
  });

  it('Cinder Lash hits and takes 1 MP off the target next turn', () => {
    expect(at(cast(fight({ b: cell(13, 5) }), 'cinder_lash', cell(13, 5)).state, 'b').hp).toBe(88);
    expect(at(pass(cast(fight({ b: cell(13, 5) }), 'cinder_lash', cell(13, 5), LOW).state, 'a'), 'b').mp).toBe(2);
  });

  it('Guardian Swap shields an ally, then takes its place', () => {
    const r = cast(fight({ a2: cell(13, 5) }), 'guardian_swap', cell(13, 5));
    expect(shieldOf(at(r.state, 'a2'))).toBe(10);
    expect([at(r.state, 'a').cell, at(r.state, 'a2').cell]).toEqual([cell(13, 5), A_CELL]);
  });

  it('Beacon teleports the Mender, then heals it and allies around it', () => {
    const state = hurtBy(hurtBy(fight({ a2: cell(12, 6) }), 'a', 20), 'a2', 20);
    const r = cast(state, 'beacon', cell(12, 5));
    expect(at(r.state, 'a')).toMatchObject({ cell: cell(12, 5), hp: 90 });
    expect(at(r.state, 'a2').hp).toBe(90);
  });

  it('Spring Tide heals the Mender and allies within 2 cells of the target', () => {
    const r = cast(hurtBy(hurtBy(fight({ a2: cell(11, 6) }), 'a', 30), 'a2', 30), 'spring_tide', A_CELL);
    expect([at(r.state, 'a').hp, at(r.state, 'a2').hp]).toEqual([87, 87]);
  });

  it('Cleansing Flame burns enemies and heals allies in the same circle', () => {
    const r = cast(hurtBy(fight({ b: cell(13, 5), a2: cell(13, 6) }), 'a2', 20), 'cleansing_flame', cell(13, 5));
    expect([at(r.state, 'b').hp, at(r.state, 'a2').hp]).toEqual([83, 90]);
  });

  it('Second Dawn gives allies within 3 cells +2 AP and +2 MP on their turn, not the Mender', () => {
    let state = cast(fight({ a2: cell(11, 6) }), 'second_dawn', A_CELL).state;
    expect(at(state, 'a')).toMatchObject({ ap: 2, mp: 3 });
    state = pass(state, 'a', 'b');
    expect(at(state, 'a2')).toMatchObject({ ap: 8, mp: 5 });
  });

  it('Lifebond shields the Mender and allies within 2 cells for 25% of their max HP', () => {
    const state = cast(fight({ a2: cell(11, 6) }), 'lifebond', A_CELL).state;
    expect([shieldOf(at(state, 'a')), shieldOf(at(state, 'a2'))]).toEqual([25, 25]);
  });
});
