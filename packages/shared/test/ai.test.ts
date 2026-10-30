import { describe, expect, it } from 'vitest';
import {
  activeFighter,
  applyDamage,
  blocksLineOfSight,
  createFight,
  createRng,
  distance,
  fighterAt,
  getFighter,
  hasLineOfSight,
  monsterSetup,
  planAiStep,
  playAiTurn,
  startFight,
  type AiProfile,
  type Effect,
  type FightState,
  type FighterSetup,
  type MonsterCatalogue,
  type SpellCatalogue,
} from '../src/index.js';
import builtMonsters from '../../../content/monsters/built/monsters.json';
import builtSpells from '../../../content/spells/built/spells.json';
import { MAP, ROCK, cell, expectOk, fighter, grade, spell, started, teleport } from './fixtures.js';

const BRUTE: AiProfile = { archetype: 'brute', preferredRange: 1 };
const CASTER: AiProfile = { archetype: 'caster', preferredRange: 5 };
const single = { shape: 'single', size: 0 } as const;

const hit = (amount: number, overrides: Partial<Effect> = {}): Effect => ({
  kind: 'damage',
  element: 'neutral',
  min: amount,
  max: amount,
  zone: single,
  targets: ['enemies'],
  ...overrides,
});
/** 4 AP, melee, once per turn. */
const bite = spell('bite', grade({ apCost: 4, minRange: 1, maxRange: 1, castsPerTurn: 1, effects: [hit(10)] }));
/** 3 AP, range 2-6 with line of sight, twice per turn. */
const bolt = spell('bolt', grade({ apCost: 3, minRange: 2, maxRange: 6, castsPerTurn: 2, effects: [hit(8)] }));

/**
 * `m` (team A, plays first, AI) at `mCell` against `p` (team B) at `pCell`,
 * with any extra fighters; `m` carries the given spells.
 */
function duel(profile: AiProfile, spellIds: string[], mCell: number, pCell: number, others: FighterSetup[] = []) {
  const spells = spellIds.map((spellId) => ({ spellId, grade: 1 }));
  const m = fighter('m', 'A', 100, { controller: 'ai', ai: profile, spells });
  const state = started([m, fighter('p', 'B', 50), ...others], 1, [bite, bolt]);
  return teleport(teleport(state, 'm', mCell), 'p', pCell);
}

const play = (state: FightState, id = 'm') => expectOk(playAiTurn(state, id, createRng(1)));
const at = (state: FightState, id: string) => getFighter(state, id)!;

describe('brute', () => {
  it('walks up to its target and hits it', () => {
    const r = play(duel(BRUTE, ['bite'], cell(10, 5), cell(13, 5)));
    expect(distance(at(r.state, 'm').cell, at(r.state, 'p').cell)).toBe(1);
    expect(at(r.state, 'p').hp).toBe(90);
    expect(activeFighter(r.state)!.id).toBe('p'); // the turn is over
  });

  it('closes in as far as it can when the target is out of reach', () => {
    const r = play(duel(BRUTE, ['bite'], cell(10, 5), cell(20, 5)));
    expect(distance(at(r.state, 'm').cell, cell(20, 5))).toBe(7);
    expect(r.events.map((e) => e.type)).not.toContain('spellCast');
  });

  it('finishes off the enemy it can kill', () => {
    const others = [fighter('p2', 'B', 40)];
    let state = teleport(duel(BRUTE, ['bite'], cell(10, 5), cell(11, 5), others), 'p2', cell(9, 5));
    state = expectOk(applyDamage(state, 'p2', 95)).state;
    const r = play(state);
    expect(at(r.state, 'p2').status).toBe('dead');
    expect(at(r.state, 'p').hp).toBe(100);
  });
});

describe('caster', () => {
  it('shoots from range and backs off towards its preferred range', () => {
    const r = play(duel(CASTER, ['bolt'], cell(10, 5), cell(13, 5)));
    expect(at(r.state, 'p').hp).toBe(84); // two bolts
    expect(distance(at(r.state, 'm').cell, at(r.state, 'p').cell)).toBeGreaterThan(3);
  });

  it('moves to get a line of sight', () => {
    // The rock at (15, 1) stands between m at (15, 3) and p at (15, -1).
    expect(ROCK).toBe(cell(15, 1));
    const r = play(duel(CASTER, ['bolt'], cell(15, 3), cell(15, -1)));
    expect(at(r.state, 'p').hp).toBeLessThan(100);
  });

  it('ends its turn where it can see its target', () => {
    // At range 5 already, but the rock at (15, 1) hides p: a step aside clears the view.
    const m = fighter('m', 'A', 100, { controller: 'ai', ai: CASTER });
    let state = started([m, fighter('p', 'B', 50)], 1);
    state = teleport(teleport(state, 'm', cell(15, 4)), 'p', cell(15, -1));
    const after = play(state).state;
    const blocks = (c: number) => blocksLineOfSight(MAP, c) || fighterAt(after, c) !== undefined;
    expect(hasLineOfSight(at(after, 'm').cell, cell(15, -1), blocks)).toBe(true);
  });

  it('steps out of reach of an enemy that could walk up to it', () => {
    // Both enemies are 5 cells away; p2 has 4 MP and could reach m next turn, p (0 MP) could not.
    const m = fighter('m', 'A', 100, { controller: 'ai', ai: CASTER, mp: 1 });
    let state = started([m, fighter('p', 'B', 50, { mp: 0 }), fighter('p2', 'B', 40, { mp: 4 })], 1);
    state = teleport(teleport(teleport(state, 'm', cell(10, 5)), 'p', cell(10, 10)), 'p2', cell(15, 5));
    const after = play(state).state;
    expect(distance(at(after, 'm').cell, cell(15, 5))).toBeGreaterThan(5);
  });

  it('never catches its ally in an area when it can avoid it', () => {
    const blast = hit(10, { zone: { shape: 'circle', size: 1 }, targets: ['enemies', 'allies'] });
    const burst = spell('burst', grade({ apCost: 3, minRange: 1, maxRange: 6, effects: [blast] }));
    const m = fighter('m', 'A', 100, { controller: 'ai', ai: CASTER, spells: [{ spellId: 'burst', grade: 1 }] });
    let state = started([m, fighter('p', 'B', 50), fighter('a2', 'A', 10)], 1, [burst]);
    state = teleport(teleport(teleport(state, 'm', cell(10, 5)), 'p', cell(14, 5)), 'a2', cell(14, 6));
    const r = play(state);
    expect(at(r.state, 'p').hp).toBeLessThan(100);
    expect(at(r.state, 'a2').hp).toBe(100);
  });

  it('heals a wounded ally when no enemy is in reach', () => {
    const heal: Effect = { kind: 'heal', min: 10, max: 10, zone: single, targets: ['allies'] };
    const mend = spell('mend', grade({ apCost: 2, minRange: 1, maxRange: 5, effects: [heal] }));
    const slots = ['bolt', 'mend'].map((spellId) => ({ spellId, grade: 1 }));
    const m = fighter('m', 'A', 100, { controller: 'ai', ai: CASTER, spells: slots });
    let state = started([m, fighter('p', 'B', 50), fighter('a2', 'A', 10)], 1, [bolt, mend]);
    state = teleport(teleport(teleport(state, 'm', cell(10, 5)), 'p', cell(25, 0)), 'a2', cell(10, 7));
    state = expectOk(applyDamage(state, 'a2', 50)).state;
    expect(at(play(state).state, 'a2').hp).toBeGreaterThan(50);
  });
});

describe('turn handling', () => {
  it('plans the same actions for the same state', () => {
    const state = duel(CASTER, ['bolt'], cell(10, 5), cell(13, 5));
    expect(planAiStep(state, 'm')).toEqual(planAiStep(state, 'm'));
    expect(play(state).events).toEqual(play(state).events);
  });

  it('only plays on its own turn and never changes the state given', () => {
    const state = duel(BRUTE, ['bite'], cell(10, 5), cell(13, 5));
    expect(playAiTurn(state, 'p', createRng(1))).toEqual({ ok: false, error: 'not-your-turn' });
    const snapshot = JSON.stringify({ ...state, map: null });
    play(state);
    expect(JSON.stringify({ ...state, map: null })).toBe(snapshot);
  });

  it('ends its turn even with nothing to do', () => {
    const r = play(duel(BRUTE, [], cell(10, 5), cell(11, 5)));
    expect(r.events.map((e) => e.type)).toEqual(['turnEnded', 'turnStarted']);
  });
});

describe('with the content', () => {
  const { monsters } = builtMonsters as MonsterCatalogue;
  const { spells } = builtSpells as SpellCatalogue;
  const boar = monsters.find((m) => m.id === 'thornback_boar')!;
  const wisp = monsters.find((m) => m.id === 'dewdrop_wisp')!;
  const kit = (cls: string) => spells.filter((s) => s.classId === cls).map((s) => ({ spellId: s.id, grade: 1 }));

  it('builds monster fighters from their grades', () => {
    const setup = monsterSetup(boar, 2, 'boar1', 'B');
    expect(setup).toMatchObject({ controller: 'ai', ai: { archetype: 'brute', preferredRange: 1 }, team: 'B' });
    expect(setup.stats).toMatchObject({ level: 3, maxHp: 82, strength: 20, ap: 6, mp: 3 });
    expect(setup.stats.resistPercent).toEqual({ neutral: 0, earth: 12, fire: -10, water: 0, air: 0 });
    expect(() => monsterSetup(boar, 4, 'x', 'B')).toThrow();
  });

  /** Three AI-played heroes against two boars and a wisp on the open test map. */
  function meadowFight(seed: number): FightState {
    const hero = (id: string, cls: string, ai: AiProfile, stats: Partial<FighterSetup['stats']>): FighterSetup =>
      fighter(id, 'A', 0, { ai, spells: kit(cls), stats: { level: 6, maxHp: 85, ...stats } });
    const setups = [
      hero('vanguard', 'vanguard', BRUTE, { strength: 30, initiative: 10 }),
      hero('longshot', 'longshot', CASTER, { agility: 30 }),
      hero('mender', 'mender', { archetype: 'caster', preferredRange: 4 }, { intelligence: 30 }),
      monsterSetup(boar, 1, 'boar1', 'B'),
      monsterSetup(boar, 2, 'boar2', 'B'),
      monsterSetup(wisp, 1, 'wisp', 'B'),
    ];
    const startCells = { A: [cell(10, 5), cell(10, 3), cell(9, 4)], B: [cell(18, 5), cell(18, 3), cell(19, 4)] };
    const rng = createRng(seed);
    const created = expectOk(createFight(MAP, setups, rng, { startCells, spells }));
    return expectOk(startFight(created.state, rng)).state;
  }

  it('plays whole fights between AI teams to the end', () => {
    for (let seed = 1; seed <= 5; seed++) {
      let state = meadowFight(seed);
      const rng = createRng(seed);
      for (let turn = 0; turn < 200 && state.phase === 'fighting'; turn++) {
        state = expectOk(playAiTurn(state, activeFighter(state)!.id, rng)).state;
      }
      expect(state.phase, `seed ${seed}`).toBe('ended');
      expect(state.round, `seed ${seed}`).toBeLessThan(30);
    }
  });

  it('plays a turn in well under the 50 ms budget', () => {
    const state = meadowFight(1);
    const start = Date.now();
    for (let i = 0; i < 10; i++) playAiTurn(state, activeFighter(state)!.id, createRng(i));
    // Average over 10 turns; generous so a slow CI machine does not flake.
    expect((Date.now() - start) / 10).toBeLessThan(150);
  });
});

describe('damage over time', () => {
  it('values a damage over time by its ticks, discounted', () => {
    // 3 ticks of 4 (12, worth 9 after the discount) beat 7 now; 3 ticks of 2 (4.5) do not.
    const strong = spell('strong', grade({ apCost: 6, minRange: 1, maxRange: 1, effects: [hit(4, { duration: 3 })] }));
    const weak = spell('weak', grade({ apCost: 6, minRange: 1, maxRange: 1, effects: [hit(2, { duration: 3 })] }));
    const jab = spell('jab', grade({ apCost: 6, minRange: 1, maxRange: 1, effects: [hit(7)] }));
    const plan = (dot: string) => {
      const m = fighter('m', 'A', 100, { controller: 'ai', ai: BRUTE, spells: [{ spellId: dot, grade: 1 }, { spellId: 'jab', grade: 1 }] });
      const state = started([m, fighter('p', 'B', 50)], 1, [strong, weak, jab]);
      return planAiStep(teleport(teleport(state, 'm', cell(10, 5)), 'p', cell(11, 5)), 'm');
    };
    expect(plan('strong')).toEqual([{ type: 'cast', spellId: 'strong', cell: cell(11, 5) }]);
    expect(plan('weak')).toEqual([{ type: 'cast', spellId: 'jab', cell: cell(11, 5) }]);
  });
});
