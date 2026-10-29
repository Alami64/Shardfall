import { describe, expect, it } from 'vitest';
import {
  activeFighter,
  applyDamage,
  castSpell,
  effectiveStats,
  endTurn,
  getFighter,
  moveFighter,
  perElement,
  shieldOf,
  type Effect,
  type FightEvent,
  type FightState,
  type FighterSetup,
  type FighterStats,
  type Rng,
  type SpellCatalogue,
  type SpellGrade,
} from '../src/index.js';
import builtSpells from '../../../content/spells/built/spells.json';
import { ROCK, cell, expectOk, fighter, grade, spell, started, teleport } from './fixtures.js';

const A_CELL = cell(10, 5);
const B_CELL = cell(12, 5);
/** Rolls the top of every range and never crits (unless the chance is 99% or more). */
const HIGH: Rng = () => 0.99;
/** Rolls the bottom of every range and always crits. */
const LOW: Rng = () => 0;

const single = { shape: 'single', size: 0 } as const;

function fx(kind: Effect['kind'], overrides: Partial<Effect> = {}): Effect {
  return { kind, zone: single, targets: ['enemies'], ...overrides };
}

interface SceneOptions {
  grade?: Partial<SpellGrade>;
  a?: Partial<FighterStats>;
  b?: Partial<FighterStats>;
  /** Extra fighters; they join after a and b. */
  others?: FighterSetup[];
}

/**
 * `a` (team A, plays first) at (10, 5) carries spell `s` (1 AP, range 0-6, no
 * line of sight needed) with the given effects; `b` (team B, a monster) stands
 * at (12, 5). Both have 100 HP.
 */
function scene(effects: Effect[], opts: SceneOptions = {}): FightState {
  const s = spell('s', grade({ apCost: 1, minRange: 0, maxRange: 6, needsLineOfSight: false, effects, ...opts.grade }));
  const slots = [{ spellId: 's', grade: 1 }];
  const setups = [
    fighter('a', 'A', 100, { spells: slots, stats: opts.a }),
    fighter('b', 'B', 50, { controller: 'ai', stats: opts.b }),
    ...(opts.others ?? []),
  ];
  return teleport(teleport(started(setups, 1, [s]), 'a', A_CELL), 'b', B_CELL);
}

const cast = (state: FightState, target: number, rng: Rng = HIGH) => expectOk(castSpell(state, 'a', 's', target, rng));
const hp = (state: FightState, id: string) => getFighter(state, id)!.hp;
const types = (events: FightEvent[]) => events.map((e) => e.type);
const pass = (state: FightState, ...ids: string[]) =>
  ids.reduce((s, id) => expectOk(endTurn(s, id)).state, state);

describe('damage', () => {
  it('applies the damage formula, then resistances, then erosion', () => {
    const state = scene([fx('damage', { element: 'earth', min: 20, max: 20 })], {
      a: { strength: 50, power: 10, damage: { ...perElement(), earth: 5 } },
      b: { resistPercent: { ...perElement(), earth: 30 }, resistFlat: { ...perElement(), earth: 5 } },
    });
    const r = cast(state, B_CELL);
    // floor(20 × 160 / 100) + 5 = 37; floor(37 × 70 / 100) - 5 = 20
    expect(r.events).toContainEqual({ type: 'damaged', fighterId: 'b', amount: 20, erosion: 2, hp: 80 });
    expect(getFighter(r.state, 'b')!.maxHp).toBe(98);
  });

  it('rolls once per cast between min and max', () => {
    const state = scene([fx('damage', { element: 'neutral', min: 10, max: 20 })]);
    expect(hp(cast(state, B_CELL, LOW).state, 'b')).toBe(90);
    expect(hp(cast(state, B_CELL, HIGH).state, 'b')).toBe(80);
  });

  it('caps player resistances at 50%', () => {
    const effects = [fx('damage', { element: 'fire', min: 40, max: 40 })];
    const b = { resistPercent: { ...perElement(), fire: 80 } };
    expect(hp(cast(scene(effects, { b }), B_CELL).state, 'b')).toBe(92); // monster: 20% gets through
    const asPlayer = scene(effects, { b });
    asPlayer.fighters[1]!.controller = 'player';
    expect(hp(cast(asPlayer, B_CELL).state, 'b')).toBe(80);
  });

  it('hits only the fighters the effect targets, across its area', () => {
    const ally = fighter('a2', 'A', 10);
    const circle = { shape: 'circle', size: 1 } as const;
    const setup = (targets: Effect['targets']) => {
      const hit = fx('damage', { element: 'neutral', min: 10, max: 10, zone: circle, targets });
      return teleport(scene([hit], { others: [ally] }), 'a2', cell(12, 6));
    };

    const enemiesOnly = cast(setup(['enemies']), B_CELL).state;
    expect([hp(enemiesOnly, 'b'), hp(enemiesOnly, 'a2')]).toEqual([90, 100]);
    const both = cast(setup(['enemies', 'allies']), B_CELL).state;
    expect([hp(both, 'b'), hp(both, 'a2')]).toEqual([90, 90]);
    const self = cast(setup(['self']), cell(11, 5)).state; // a stands in the circle around (11, 5)
    expect([hp(self, 'a'), hp(self, 'b')]).toEqual([90, 100]);
  });

  it('steals: the caster heals half of the HP taken', () => {
    const state = scene([fx('steal', { element: 'water', min: 21, max: 21 })]);
    const wounded = expectOk(applyDamage(state, 'a', 50)).state;
    const r = cast(wounded, B_CELL);
    expect(hp(r.state, 'b')).toBe(79);
    expect(r.events).toContainEqual({ type: 'healed', fighterId: 'a', amount: 10, hp: 60 });
  });
});

describe('critical hits', () => {
  const critGrade = (chance: number, withCriticalEffects = true): Partial<SpellGrade> => ({
    criticalChance: chance,
    criticalEffects: withCriticalEffects ? [fx('damage', { element: 'earth', min: 30, max: 30 })] : [],
  });
  const normal = [fx('damage', { element: 'earth', min: 10, max: 10 })];

  it('use the critical effects and add Critical Damage', () => {
    const state = scene(normal, { grade: critGrade(10), a: { criticalDamage: 8 } });
    const r = cast(state, B_CELL, LOW);
    expect(r.events[0]).toMatchObject({ type: 'spellCast', critical: true });
    expect(hp(r.state, 'b')).toBe(62);
    expect(hp(cast(state, B_CELL, () => 0.5).state, 'b')).toBe(90); // 50 is not under 10
  });

  it('add the caster critical chance to the spell', () => {
    const state = scene(normal, { grade: critGrade(10), a: { criticalChance: 50 } });
    expect(cast(state, B_CELL, () => 0.5).events[0]).toMatchObject({ critical: true }); // 50 < 60
  });

  it('never happen on a spell without critical effects', () => {
    const state = scene(normal, { grade: critGrade(0, false), a: { criticalChance: 100 } });
    expect(cast(state, B_CELL, LOW).events[0]).toMatchObject({ critical: false });
  });
});

describe('heals and shields', () => {
  it('heals by the formula, up to the eroded max HP', () => {
    const state = scene([fx('heal', { min: 30, max: 30, targets: ['allies'] })], {
      a: { intelligence: 100 },
      others: [fighter('a2', 'A', 10)],
    });
    const hurtAlly = teleport(expectOk(applyDamage(state, 'a2', 50)).state, 'a2', cell(10, 7));
    const r = cast(hurtAlly, cell(10, 7));
    // 60 healed would overshoot: max HP is 95 after erosion.
    expect(r.events).toContainEqual({ type: 'healed', fighterId: 'a2', amount: 45, hp: 95 });
  });

  it('absorbs damage with a shield before HP', () => {
    const state = scene([fx('shield', { min: 30, max: 30, duration: 2, targets: ['self'] })]);
    const shielded = cast(state, A_CELL).state;
    expect(shieldOf(getFighter(shielded, 'a')!)).toBe(30);
    const r = expectOk(applyDamage(shielded, 'a', 50));
    expect(r.events).toEqual([
      { type: 'shieldHit', fighterId: 'a', absorbed: 30, remaining: 0 },
      { type: 'damaged', fighterId: 'a', amount: 20, erosion: 2, hp: 80 },
    ]);
    expect(getFighter(r.state, 'a')!.buffs).toEqual([]);
  });

  it('can size a shield from the target max HP', () => {
    const state = scene([fx('shield', { duration: 1, targets: ['self'], params: { maxHpPercent: 15 } })]);
    expect(shieldOf(getFighter(cast(state, A_CELL).state, 'a')!)).toBe(15);
  });
});

describe('buffs and durations', () => {
  const brace = [fx('buff', { min: 20, max: 20, duration: 1, targets: ['self'], params: { stat: 'resistPercent' } })];

  it('changes stats until the start of the caster next turn', () => {
    const r = cast(scene(brace), A_CELL);
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'buffAdded', fighterId: 'a' }));
    let state = r.state;
    expect(effectiveStats(getFighter(state, 'a')!).resistPercent).toEqual(perElement(20));
    state = pass(state, 'a');
    expect(effectiveStats(getFighter(state, 'a')!).resistPercent.earth).toBe(20); // still up on b's turn
    const back = expectOk(endTurn(state, 'b'));
    expect(back.events).toContainEqual(expect.objectContaining({ type: 'buffExpired', fighterId: 'a' }));
    expect(effectiveStats(getFighter(back.state, 'a')!).resistPercent.earth).toBe(0);
  });

  it('applies to one element when the effect names one', () => {
    const fireOnly = [
      fx('buff', { min: 5, max: 5, duration: 1, targets: ['self'], element: 'fire', params: { stat: 'damage' } }),
    ];
    const stats = effectiveStats(getFighter(cast(scene(fireOnly), A_CELL).state, 'a')!);
    expect(stats.damage).toEqual({ ...perElement(), fire: 5 });
  });

  it('gives AP at once on the caster own turn, and on its next turns while it lasts', () => {
    const ap = (duration: number) =>
      scene([fx('buff', { min: 2, max: 2, duration, targets: ['self'], params: { stat: 'ap' } })]);
    const now = cast(ap(1), A_CELL).state;
    expect(getFighter(now, 'a')!.ap).toBe(7); // 6 - 1 AP + 2
    expect(getFighter(pass(now, 'a', 'b'), 'a')!.ap).toBe(6); // expired before the refill
    expect(getFighter(pass(cast(ap(2), A_CELL).state, 'a', 'b'), 'a')!.ap).toBe(8);
  });

  it('gives an ally its AP on its next turn', () => {
    const quickening = [fx('buff', { min: 2, max: 2, duration: 1, targets: ['allies'], params: { stat: 'ap' } })];
    let state = teleport(scene(quickening, { others: [fighter('a2', 'A', 10)] }), 'a2', cell(10, 7));
    expect(state.turnOrder).toEqual(['a', 'b', 'a2']);
    state = pass(cast(state, cell(10, 7)).state, 'a', 'b');
    expect(activeFighter(state)!.id).toBe('a2');
    expect(getFighter(state, 'a2')!.ap).toBe(8);
    state = pass(state, 'a2', 'a', 'b');
    expect(getFighter(state, 'a2')!.ap).toBe(6);
  });

  it('changes points instantly when it has no duration', () => {
    const r = cast(scene([fx('buff', { min: 1, max: 1, targets: ['self'], params: { stat: 'mp' } })]), A_CELL);
    expect(getFighter(r.state, 'a')!.mp).toBe(4);
    expect(getFighter(r.state, 'a')!.buffs).toEqual([]);
    expect(r.events).toContainEqual({ type: 'pointsChanged', fighterId: 'a', points: 'mp', amount: 1 });
  });

  it('lowers stats with a debuff', () => {
    const state = scene([fx('debuff', { min: 2, max: 2, duration: 1, params: { stat: 'range' } })]);
    expect(effectiveStats(getFighter(cast(state, B_CELL).state, 'b')!).range).toBe(-2);
  });

  it('ends the buffs a fighter cast when it leaves the board', () => {
    const debuff = [fx('debuff', { min: 2, max: 2, duration: 3, params: { stat: 'range' } })];
    const state = cast(scene(debuff, { others: [fighter('a2', 'A', 10)] }), B_CELL).state;
    expect(getFighter(state, 'b')!.buffs).toHaveLength(1);
    const r = expectOk(applyDamage(state, 'a', 1000));
    expect(getFighter(r.state, 'b')!.buffs).toEqual([]);
  });
});

describe('states', () => {
  it('gate effects with requiresState and forbidsState', () => {
    const base = { apCost: 1, minRange: 0, maxRange: 6, needsLineOfSight: false };
    const marking = fx('state', { duration: 1, params: { state: 'marked' } });
    const mark = spell('mark', grade({ ...base, effects: [marking] }));
    const hit = (key: 'requiresState' | 'forbidsState') =>
      spell(key, grade({ ...base, effects: [fx('damage', { element: 'air', min: 10, max: 10, [key]: 'marked' })] }));
    const spells = [mark, hit('requiresState'), hit('forbidsState')];
    const slots = spells.map((s) => ({ spellId: s.id, grade: 1 }));
    let state = started([fighter('a', 'A', 100, { spells: slots }), fighter('b', 'B', 50)], 1, spells);
    state = teleport(teleport(state, 'a', A_CELL), 'b', B_CELL);
    const castBy = (s: FightState, id: string) => expectOk(castSpell(s, 'a', id, B_CELL, HIGH));

    expect(types(castBy(state, 'requiresState').events)).toEqual(['spellCast']);
    expect(hp(castBy(state, 'forbidsState').state, 'b')).toBe(90);
    state = castBy(state, 'mark').state;
    expect(hp(castBy(state, 'requiresState').state, 'b')).toBe(90);
    expect(types(castBy(state, 'forbidsState').events)).toEqual(['spellCast']);
  });
});

describe('push and pull', () => {
  const push = (cells: number) => [fx('push', { params: { cells } })];
  const pull = (cells: number) => [fx('pull', { params: { cells } })];

  it('pushes away from the caster', () => {
    const r = cast(scene(push(2)), B_CELL);
    expect(getFighter(r.state, 'b')!.cell).toBe(cell(14, 5));
    const path = [cell(13, 5), cell(14, 5)];
    expect(r.events).toContainEqual({ type: 'displaced', fighterId: 'b', path, reason: 'push' });
    expect(hp(r.state, 'b')).toBe(100);
  });

  it('deals pushback damage per cell it could not travel', () => {
    // a at (15, 5) pushes b at (15, 3) towards the rock at (15, 1): one cell travelled, one blocked.
    const state = teleport(teleport(scene(push(2)), 'a', cell(15, 5)), 'b', cell(15, 3));
    expect(ROCK).toBe(cell(15, 1));
    const r = cast(state, cell(15, 3));
    expect(getFighter(r.state, 'b')!.cell).toBe(cell(15, 2));
    expect(hp(r.state, 'b')).toBe(100 - 8); // floor((1 / 2 + 32) / 4)
  });

  it('counts other fighters and the map edge as blocking', () => {
    const blocker = fighter('b2', 'B', 40);
    const state = teleport(scene(push(3), { others: [blocker] }), 'b2', cell(13, 5));
    const r = cast(state, B_CELL);
    expect(getFighter(r.state, 'b')!.cell).toBe(B_CELL);
    expect(hp(r.state, 'b')).toBe(100 - 24); // floor(3 × 32.5 / 4)
    expect(hp(r.state, 'b2')).toBe(100);
  });

  it('pulls towards the caster without damage, stopping next to it', () => {
    const state = teleport(scene(pull(5)), 'b', cell(14, 5));
    const r = cast(state, cell(14, 5));
    expect(getFighter(r.state, 'b')!.cell).toBe(cell(11, 5));
    expect(hp(r.state, 'b')).toBe(100);
  });

  it('cannot move a rooted fighter', () => {
    const root = fx('state', { duration: 1, params: { state: 'rooted' } });
    const r = cast(scene([root, ...push(2)]), B_CELL);
    expect(getFighter(r.state, 'b')!.cell).toBe(B_CELL);
    expect(hp(r.state, 'b')).toBe(100);
  });
});

describe('AP and MP removal', () => {
  const removeMp = [fx('removeMP', { min: 2, max: 2, duration: 1 })];

  it('takes points off the target next turn when every roll succeeds', () => {
    const r = cast(scene(removeMp), B_CELL, LOW);
    expect(r.events).toContainEqual({ type: 'pointsRemoved', fighterId: 'b', points: 'mp', removed: 2, dodged: 0 });
    const bTurn = pass(r.state, 'a');
    expect(getFighter(bTurn, 'b')!.mp).toBe(1);
    expect(getFighter(pass(bTurn, 'b', 'a'), 'b')!.buffs).toEqual([]); // gone at a's next turn
  });

  it('can be dodged roll by roll', () => {
    const r = cast(scene(removeMp), B_CELL, HIGH);
    expect(r.events).toContainEqual({ type: 'pointsRemoved', fighterId: 'b', points: 'mp', removed: 0, dodged: 2 });
    expect(getFighter(pass(r.state, 'a'), 'b')!.mp).toBe(3);
  });

  it('uses removal against parry', () => {
    // Each point: 0.5 × 10 / 10 × current / 3. The first roll (0.4) beats 50%, the second (0.4) misses 33%.
    const state = scene(removeMp, { a: { mpRemoval: 10 }, b: { mpParry: 10 } });
    const r = cast(state, B_CELL, () => 0.4);
    expect(r.events).toContainEqual({ type: 'pointsRemoved', fighterId: 'b', points: 'mp', removed: 1, dodged: 1 });
  });

  it('comes straight off the points left on the target own turn', () => {
    const state = scene([fx('removeAP', { min: 2, max: 2, targets: ['self'] })]);
    const r = cast(state, A_CELL, LOW);
    expect(getFighter(r.state, 'a')!.ap).toBe(3); // 6 - 1 AP - 2
    expect(getFighter(r.state, 'a')!.buffs).toEqual([]);
  });
});

describe('teleport and swap', () => {
  it('teleports the caster to a free cell', () => {
    const state = scene([fx('teleport', { targets: ['cell'] })], { grade: { needsFreeCell: true } });
    const r = cast(state, cell(10, 8));
    expect(getFighter(r.state, 'a')!.cell).toBe(cell(10, 8));
    expect(r.events).toContainEqual({ type: 'displaced', fighterId: 'a', path: [cell(10, 8)], reason: 'teleport' });
  });

  it('swaps places with the target', () => {
    const r = cast(scene([fx('swap')]), B_CELL);
    expect(getFighter(r.state, 'a')!.cell).toBe(B_CELL);
    expect(getFighter(r.state, 'b')!.cell).toBe(A_CELL);
  });
});

describe('the end of a fight during a cast', () => {
  it('stops later effects once a team is out', () => {
    const state = scene([
      fx('damage', { element: 'neutral', min: 500, max: 500 }),
      // Centred on b's cell, this area reaches a two cells away: it would heal a if it ran.
      fx('heal', { min: 10, max: 10, targets: ['self'], zone: { shape: 'circle', size: 2 } }),
    ]);
    const r = cast(state, B_CELL);
    expect(r.state.winner).toBe('A');
    expect(types(r.events)).toEqual(['spellCast', 'damaged', 'died', 'fightEnded']);
  });
});

describe('tackle', () => {
  const walk = (state: FightState, path: number[]) => expectOk(moveFighter(state, 'a', path));

  it('costs MP and AP when leaving a cell next to an enemy, and can stop the walk', () => {
    const state = teleport(scene([]), 'b', cell(11, 5));
    const r = walk(state, [cell(10, 4), cell(10, 3)]);
    // escape = (0 + 2) / (2 × (0 + 2)) = 0.5: 3 MP -> 1, 6 AP -> 3
    expect(r.events).toEqual([
      { type: 'tackled', fighterId: 'a', cell: A_CELL, apLost: 3, mpLost: 2 },
      { type: 'moved', fighterId: 'a', path: [cell(10, 4)] },
    ]);
    expect(getFighter(r.state, 'a')).toMatchObject({ cell: cell(10, 4), mp: 0, ap: 3 });
  });

  it('can strike in the middle of a path', () => {
    const r = walk(scene([]), [cell(11, 5), cell(11, 4), cell(11, 3)]);
    expect(types(r.events)).toEqual(['moved', 'tackled', 'moved']);
    expect(getFighter(r.state, 'a')).toMatchObject({ cell: cell(11, 4), mp: 0 });
  });

  it('adds up the lock of every adjacent enemy against the mover dodge', () => {
    const others = [fighter('b2', 'B', 40, { stats: { lock: 6 } })];
    const base = scene([], { a: { dodge: 4 }, b: { lock: 4 }, others });
    const state = teleport(teleport(base, 'b', cell(11, 5)), 'b2', cell(9, 5));
    // escape = 6 / (2 × 12) = 0.25: 3 MP -> 0
    const r = walk(state, [cell(10, 4)]);
    expect(r.events).toEqual([{ type: 'tackled', fighterId: 'a', cell: A_CELL, apLost: 5, mpLost: 3 }]);
    expect(getFighter(r.state, 'a')!.cell).toBe(A_CELL);
  });

  it('is escaped with enough dodge, and allies never tackle', () => {
    const dodgy = teleport(scene([], { a: { dodge: 10 } }), 'b', cell(11, 5));
    expect(types(walk(dodgy, [cell(10, 4)]).events)).toEqual(['moved']);
    const allyNext = teleport(scene([], { others: [fighter('a2', 'A', 10)] }), 'a2', cell(11, 5));
    expect(types(walk(allyNext, [cell(10, 4)]).events)).toEqual(['moved']);
  });

  it('takes everything against a very high Lock', () => {
    const state = teleport(scene([], { b: { lock: 98 } }), 'b', cell(11, 5));
    // escape = 2 / 200 = 0.01: everything is lost
    expect(getFighter(walk(state, [cell(10, 4)]).state, 'a')).toMatchObject({ mp: 0, ap: 0, cell: A_CELL });
  });
});

describe('purity', () => {
  it('never changes the state it was given', () => {
    const state = scene([
      fx('damage', { element: 'earth', min: 10, max: 10 }),
      fx('push', { params: { cells: 2 } }),
      fx('debuff', { min: 1, max: 1, duration: 2, params: { stat: 'mp' } }),
    ]);
    const snapshot = JSON.stringify({ ...state, map: null });
    cast(state, B_CELL);
    moveFighter(teleport(state, 'b', cell(11, 5)), 'a', [cell(10, 4)]);
    expect(JSON.stringify({ ...state, map: null })).toBe(snapshot);
  });
});

describe('content spells', () => {
  const { spells } = builtSpells as SpellCatalogue;

  it('deal their listed damage', () => {
    const cleave = spells.find((s) => s.id === 'cleave')!;
    const slots = [{ spellId: 'cleave', grade: 1 }];
    const setups = [fighter('a', 'A', 100, { spells: slots }), fighter('b', 'B', 50, { controller: 'ai' })];
    let state = started(setups, 1, spells);
    state = teleport(teleport(state, 'a', A_CELL), 'b', cell(11, 5));
    const max = cleave.grades[0]!.effects[0]!.max!;
    expect(hp(expectOk(castSpell(state, 'a', 'cleave', cell(11, 5), HIGH)).state, 'b')).toBe(100 - max);
  });
});
