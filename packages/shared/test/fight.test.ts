import { describe, expect, it } from 'vitest';
import {
  activeFighter,
  applyDamage,
  computeTurnOrder,
  createFight,
  createRng,
  endTurn,
  fighterAt,
  flee,
  getFighter,
  initiativeOf,
  joinFight,
  moveFighter,
  movePath,
  movementRange,
  placeFighter,
  startFight,
} from '../src/index.js';
import { MAP, ROCK, START, cell, create, expectOk, fighter, started, teleport } from './fixtures.js';

describe('placement', () => {
  it('puts every fighter on a distinct free start cell of its team', () => {
    const r = expectOk(
      createFight(MAP, [fighter('a1', 'A', 0), fighter('a2', 'A', 0), fighter('b1', 'B', 0)], createRng(5)),
    );
    const cells = r.state.fighters.map((f) => f.cell);
    expect(new Set(cells).size).toBe(3);
    expect(START.A).toContain(getFighter(r.state, 'a1')!.cell);
    expect(START.A).toContain(getFighter(r.state, 'a2')!.cell);
    expect(START.B).toContain(getFighter(r.state, 'b1')!.cell);
    expect(r.state.phase).toBe('placement');
    expect(r.events.map((e) => e.type)).toEqual(['joined', 'joined', 'joined']);
  });

  it('reads start cells from the map flags unless given', () => {
    const sorted = (cells: number[]) => [...cells].sort((x, y) => x - y);
    expect(create([fighter('a', 'A', 0)]).startCells).toEqual({ A: sorted(START.A), B: sorted(START.B) });
    const custom = { A: [cell(5, 0)], B: [cell(6, 0)] };
    const r = expectOk(createFight(MAP, [fighter('a', 'A', 0)], createRng(1), { startCells: custom }));
    expect(getFighter(r.state, 'a')!.cell).toBe(cell(5, 0));
  });

  it('refuses a fighter when its team has no free start cell', () => {
    const four = ['a1', 'a2', 'a3', 'a4'].map((id) => fighter(id, 'A', 0));
    expect(createFight(MAP, four, createRng(1))).toEqual({ ok: false, error: 'no-free-start-cell' });
  });

  it('refuses duplicate ids', () => {
    const state = create([fighter('a', 'A', 0)]);
    expect(joinFight(state, fighter('a', 'B', 0), createRng(1))).toEqual({ ok: false, error: 'duplicate-fighter' });
  });

  it('lets fighters join until placement ends', () => {
    const state = create([fighter('a', 'A', 0), fighter('b', 'B', 0)]);
    const joined = expectOk(joinFight(state, fighter('c', 'A', 0), createRng(2))).state;
    expect(joined.fighters).toHaveLength(3);
    const fighting = expectOk(startFight(joined, createRng(1))).state;
    expect(joinFight(fighting, fighter('d', 'A', 0), createRng(1))).toEqual({ ok: false, error: 'wrong-phase' });
  });

  it('starts fighters at full HP, AP and MP unless told otherwise', () => {
    const state = create([fighter('a', 'A', 0), fighter('w', 'A', 0, { hp: 40 }), fighter('z', 'B', 0, { hp: -5 })]);
    expect(getFighter(state, 'a')).toMatchObject({ hp: 100, ap: 6, mp: 3, status: 'alive' });
    expect(getFighter(state, 'w')!.hp).toBe(40);
    expect(getFighter(state, 'z')!.hp).toBe(1); // clamped: nobody enters a fight dead
  });

  it('moves a fighter to a free start cell of its own team only', () => {
    const state = create([fighter('a', 'A', 0)]);
    const free = START.A.find((c) => c !== getFighter(state, 'a')!.cell)!;
    const r = expectOk(placeFighter(state, 'a', free));
    expect(getFighter(r.state, 'a')!.cell).toBe(free);
    expect(r.events).toEqual([{ type: 'placed', fighterId: 'a', cell: free }]);
    expect(placeFighter(state, 'a', START.B[0]!)).toEqual({ ok: false, error: 'not-a-start-cell' });
    expect(placeFighter(state, 'a', cell(5, 0))).toEqual({ ok: false, error: 'not-a-start-cell' });
    expect(placeFighter(state, 'nobody', free)).toEqual({ ok: false, error: 'unknown-fighter' });
  });

  it('swaps cells with an ally', () => {
    const state = create([fighter('a1', 'A', 0), fighter('a2', 'A', 0)]);
    const c1 = getFighter(state, 'a1')!.cell;
    const c2 = getFighter(state, 'a2')!.cell;
    const r = expectOk(placeFighter(state, 'a1', c2));
    expect(getFighter(r.state, 'a1')!.cell).toBe(c2);
    expect(getFighter(r.state, 'a2')!.cell).toBe(c1);
    expect(r.events).toEqual([
      { type: 'placed', fighterId: 'a1', cell: c2 },
      { type: 'placed', fighterId: 'a2', cell: c1 },
    ]);
    // The input state is untouched.
    expect(getFighter(state, 'a1')!.cell).toBe(c1);
  });

  it('never swaps with an enemy, even when start cells overlap', () => {
    const shared = cell(5, 0);
    const startCells = { A: [shared, cell(5, 1)], B: [shared] };
    const setups = [fighter('b', 'B', 0), fighter('a', 'A', 0)];
    const state = expectOk(createFight(MAP, setups, createRng(1), { startCells })).state;
    expect(getFighter(state, 'a')!.cell).toBe(cell(5, 1));
    expect(placeFighter(state, 'a', shared)).toEqual({ ok: false, error: 'cell-occupied' });
  });

  it('needs both teams to start', () => {
    const state = create([fighter('a', 'A', 0)]);
    expect(startFight(state, createRng(1))).toEqual({ ok: false, error: 'missing-team' });
  });
});

describe('initiative and turn order', () => {
  it('scales initiative with the share of HP left', () => {
    const base = fighter('a', 'A', 50);
    const state = create([
      { ...base, stats: { ...base.stats, strength: 30, intelligence: 10, chance: 5, agility: 5 } },
      fighter('w', 'A', 100, { hp: 33 }),
    ]);
    expect(initiativeOf(getFighter(state, 'a')!)).toBe(100);
    expect(initiativeOf(getFighter(state, 'w')!)).toBe(33);
  });

  it('alternates teams, starting with the highest initiative', () => {
    const state = create([
      fighter('a50', 'A', 50),
      fighter('a100', 'A', 100),
      fighter('b10', 'B', 10),
      fighter('b80', 'B', 80),
      fighter('b70', 'B', 70),
    ]);
    expect(computeTurnOrder(state.fighters, createRng(1))).toEqual(['a100', 'b80', 'a50', 'b70', 'b10']);
  });

  it('lets team B open when its best fighter is faster', () => {
    const state = create([fighter('a', 'A', 60), fighter('b', 'B', 90)]);
    expect(computeTurnOrder(state.fighters, createRng(1))).toEqual(['b', 'a']);
  });

  it('plays a wounded fighter later', () => {
    const state = create([fighter('a', 'A', 100, { hp: 50 }), fighter('b', 'B', 80)]);
    expect(computeTurnOrder(state.fighters, createRng(1))).toEqual(['b', 'a']);
  });

  it('breaks ties with the RNG, reproducibly', () => {
    const state = create([fighter('a1', 'A', 50), fighter('a2', 'A', 50), fighter('b', 'B', 50)]);
    const orders = new Set<string>();
    for (let seed = 0; seed < 50; seed++) {
      const order = computeTurnOrder(state.fighters, createRng(seed));
      expect(computeTurnOrder(state.fighters, createRng(seed))).toEqual(order);
      orders.add(order.join(','));
    }
    // Who opens and which A fighter goes first both vary: 4 possible orders.
    expect(orders.size).toBe(4);
  });

  it('starts the first turn with full points in round 1', () => {
    const r = expectOk(startFight(create([fighter('a', 'A', 100), fighter('b', 'B', 50)]), createRng(1)));
    expect(r.state.phase).toBe('fighting');
    expect(r.state.round).toBe(1);
    expect(r.state.turnOrder).toEqual(['a', 'b']);
    expect(activeFighter(r.state)!.id).toBe('a');
    expect(r.events).toEqual([
      { type: 'fightStarted', turnOrder: ['a', 'b'] },
      { type: 'turnStarted', fighterId: 'a', round: 1 },
    ]);
    expect(placeFighter(r.state, 'a', START.A[0]!)).toEqual({ ok: false, error: 'wrong-phase' });
  });
});

describe('turns', () => {
  it('only lets the active fighter act', () => {
    const state = started();
    expect(endTurn(state, 'b')).toEqual({ ok: false, error: 'not-your-turn' });
    expect(endTurn(state, 'nobody')).toEqual({ ok: false, error: 'unknown-fighter' });
    expect(endTurn(create([fighter('a', 'A', 0)]), 'a')).toEqual({ ok: false, error: 'wrong-phase' });
  });

  it('passes the turn in order and counts rounds', () => {
    let state = started();
    const r1 = expectOk(endTurn(state, 'a'));
    expect(r1.events).toEqual([
      { type: 'turnEnded', fighterId: 'a' },
      { type: 'turnStarted', fighterId: 'b', round: 1 },
    ]);
    state = r1.state;
    const r2 = expectOk(endTurn(state, 'b'));
    expect(r2.events).toContainEqual({ type: 'turnStarted', fighterId: 'a', round: 2 });
    expect(r2.state.round).toBe(2);
  });

  it('drops unused points at turn end and refills them at turn start', () => {
    let state = teleport(started(), 'a', cell(10, 5));
    state = expectOk(moveFighter(state, 'a', [cell(9, 5)])).state;
    expect(getFighter(state, 'a')!.mp).toBe(2);
    state = expectOk(endTurn(state, 'a')).state;
    expect(getFighter(state, 'a')).toMatchObject({ ap: 0, mp: 0 });
    state = expectOk(endTurn(state, 'b')).state;
    expect(getFighter(state, 'a')).toMatchObject({ ap: 6, mp: 3 });
  });

  it('skips dead fighters', () => {
    let state = started([
      fighter('a', 'A', 100),
      fighter('b1', 'B', 90),
      fighter('a2', 'A', 80),
      fighter('b2', 'B', 70),
    ]);
    expect(state.turnOrder).toEqual(['a', 'b1', 'a2', 'b2']);
    state = expectOk(applyDamage(state, 'b1', 1000)).state;
    expect(state.turnOrder).toEqual(['a', 'b1', 'a2', 'b2']); // the slot stays for a later revive
    const r = expectOk(endTurn(state, 'a'));
    expect(activeFighter(r.state)!.id).toBe('a2');
  });

  it('never changes the state it was given', () => {
    const state = started();
    const snapshot = JSON.stringify({ ...state, map: null });
    endTurn(state, 'a');
    moveFighter(state, 'a', [cell(9, 0)]);
    applyDamage(state, 'b', 30);
    flee(state, 'a');
    expect(JSON.stringify({ ...state, map: null })).toBe(snapshot);
  });
});

describe('movement', () => {
  /** `a` stands at (10, 5) with 3 MP; `b` stands at (12, 5). */
  const scenario = () => teleport(teleport(started(), 'a', cell(10, 5)), 'b', cell(12, 5));

  it('walks an orthogonal path, 1 MP per cell', () => {
    const path = [cell(10, 4), cell(10, 3)];
    const r = expectOk(moveFighter(scenario(), 'a', path));
    expect(getFighter(r.state, 'a')).toMatchObject({ cell: cell(10, 3), mp: 1 });
    expect(r.events).toEqual([{ type: 'moved', fighterId: 'a', path }]);
    expect(fighterAt(r.state, cell(10, 3))!.id).toBe('a');
    expect(fighterAt(r.state, cell(10, 5))).toBeUndefined();
  });

  it('rejects diagonal, disconnected and blocked steps', () => {
    const state = scenario();
    expect(moveFighter(state, 'a', [cell(11, 6)])).toEqual({ ok: false, error: 'invalid-path' }); // diagonal
    expect(moveFighter(state, 'a', [cell(10, 3)])).toEqual({ ok: false, error: 'invalid-path' }); // 2 cells away
    const nextToRock = teleport(state, 'a', cell(15, 2));
    expect(moveFighter(nextToRock, 'a', [ROCK])).toEqual({ ok: false, error: 'invalid-path' });
    expect(moveFighter(state, 'a', [])).toEqual({ ok: false, error: 'empty-path' });
  });

  it('cannot walk through another fighter', () => {
    expect(moveFighter(scenario(), 'a', [cell(11, 5), cell(12, 5), cell(13, 5)])).toEqual({
      ok: false,
      error: 'cell-occupied',
    });
  });

  it('cannot spend more MP than it has left', () => {
    let state = scenario();
    const far = [cell(10, 4), cell(10, 3), cell(10, 2), cell(10, 1)];
    expect(moveFighter(state, 'a', far)).toEqual({ ok: false, error: 'not-enough-mp' });
    state = expectOk(moveFighter(state, 'a', far.slice(0, 2))).state;
    expect(moveFighter(state, 'a', far.slice(2))).toEqual({ ok: false, error: 'not-enough-mp' });
    state = expectOk(moveFighter(state, 'a', far.slice(2, 3))).state;
    expect(getFighter(state, 'a')!.mp).toBe(0);
  });

  it('cannot move out of turn', () => {
    expect(moveFighter(scenario(), 'b', [cell(12, 4)])).toEqual({ ok: false, error: 'not-your-turn' });
  });

  it('lists reachable cells by remaining MP, around fighters and obstacles', () => {
    const state = scenario();
    const range = movementRange(state, 'a');
    // 24 cells lie within 3 steps. b's cell is taken, and (13, 5) is only 3 steps away through it.
    expect(range.size).toBe(22);
    expect(range.has(cell(12, 5))).toBe(false);
    expect(range.has(cell(13, 5))).toBe(false);
    expect(range.get(cell(11, 6))).toBe(2);
    const afterStep = expectOk(moveFighter(state, 'a', [cell(9, 5)])).state;
    expect(movementRange(afterStep, 'a').size).toBe(12); // 2 MP left
  });
});

describe('damage, death and end of fight', () => {
  it('lowers HP and leaves max HP alone', () => {
    const r = expectOk(applyDamage(started(), 'b', 25));
    expect(getFighter(r.state, 'b')).toMatchObject({ hp: 75, stats: { maxHp: 100 } });
    expect(r.events).toEqual([{ type: 'damaged', fighterId: 'b', amount: 25, hp: 75 }]);
  });

  it('caps damage at the HP left', () => {
    let state = started([fighter('a', 'A', 100), fighter('b', 'B', 50), fighter('b2', 'B', 40)]);
    const r = expectOk(applyDamage(state, 'b', 500));
    expect(r.events[0]).toEqual({ type: 'damaged', fighterId: 'b', amount: 100, hp: 0 });
    state = r.state;
    expect(applyDamage(state, 'b', 5)).toEqual({ ok: false, error: 'not-alive' });
  });

  it('takes a dead fighter off the board', () => {
    const state = started([fighter('a', 'A', 100), fighter('b', 'B', 50), fighter('b2', 'B', 40)]);
    const cellOfB = getFighter(state, 'b')!.cell;
    const r = expectOk(applyDamage(state, 'b', 100));
    expect(getFighter(r.state, 'b')).toMatchObject({ status: 'dead', cell: -1, hp: 0 });
    expect(fighterAt(r.state, cellOfB)).toBeUndefined();
    expect(r.events).toContainEqual({ type: 'died', fighterId: 'b', cell: cellOfB });
    expect(r.state.phase).toBe('fighting');
  });

  it('ends the fight when the last opponent dies', () => {
    const r = expectOk(applyDamage(started(), 'b', 100));
    expect(r.state.phase).toBe('ended');
    expect(r.state.winner).toBe('A');
    expect(r.events.at(-1)).toEqual({ type: 'fightEnded', winner: 'A' });
    expect(endTurn(r.state, 'a')).toEqual({ ok: false, error: 'wrong-phase' });
    expect(activeFighter(r.state)).toBeUndefined();
  });

  it('passes the turn when the active fighter dies', () => {
    const state = started([fighter('a', 'A', 100), fighter('a2', 'A', 10), fighter('b', 'B', 50)]);
    expect(state.turnOrder).toEqual(['a', 'b', 'a2']);
    const r = expectOk(applyDamage(state, 'a', 100));
    expect(activeFighter(r.state)!.id).toBe('b');
    expect(r.events.map((e) => e.type)).toEqual(['damaged', 'died', 'turnEnded', 'turnStarted']);
  });
});

describe('fleeing', () => {
  it('is for players, on their own turn', () => {
    const state = started([fighter('a', 'A', 100), fighter('m', 'B', 50, { controller: 'ai' })]);
    expect(flee(state, 'm')).toEqual({ ok: false, error: 'not-your-turn' });
    const monsterTurn = expectOk(endTurn(state, 'a')).state;
    expect(flee(monsterTurn, 'm')).toEqual({ ok: false, error: 'cannot-flee' });
  });

  it('counts as dead: the last player to flee loses the fight', () => {
    const state = started([fighter('a', 'A', 100), fighter('m', 'B', 50, { controller: 'ai' })]);
    const r = expectOk(flee(state, 'a'));
    expect(getFighter(r.state, 'a')).toMatchObject({ status: 'fled', cell: -1 });
    expect(r.state.winner).toBe('B');
    expect(r.events.map((e) => e.type)).toEqual(['fled', 'fightEnded']);
  });

  it('passes the turn when allies remain', () => {
    const state = started([fighter('a', 'A', 100), fighter('a2', 'A', 10), fighter('b', 'B', 50)]);
    const r = expectOk(flee(state, 'a'));
    expect(r.state.phase).toBe('fighting');
    expect(activeFighter(r.state)!.id).toBe('b');
  });
});

describe('movePath', () => {
  /** a at (10, 5) with 3 MP; b two cells east at (12, 5), not adjacent (no tackle). */
  const scene = () => teleport(teleport(started(), 'a', cell(10, 5)), 'b', cell(12, 5));

  it('finds the shortest orthogonal walk within MP, ready for moveFighter', () => {
    const state = scene();
    const path = movePath(state, 'a', cell(12, 6))!;
    expect(path).toHaveLength(3);
    expect(getFighter(expectOk(moveFighter(state, 'a', path)).state, 'a')!.cell).toBe(cell(12, 6));
  });

  it('avoids passing next to an enemy when an equally cheap route exists', () => {
    const path = movePath(scene(), 'a', cell(12, 6))!;
    expect(path).not.toContain(cell(11, 5)); // next to b: leaving it would cost tackle
  });

  it('still walks past an enemy when that is the only way in reach', () => {
    // With b at (12, 6), the only 3-step route to (13, 5) runs along x through (12, 5), next to b.
    const state = teleport(scene(), 'b', cell(12, 6));
    expect(movePath(state, 'a', cell(13, 5))).toEqual([cell(11, 5), cell(12, 5), cell(13, 5)]);
  });

  it('goes around fighters, and gives up when the detour needs more MP', () => {
    // (13, 5) is 3 cells away in a straight line, but b blocks it and the way round is 5 steps.
    expect(movePath(scene(), 'a', cell(13, 5))).toBeNull();
    expect(movePath(scene(), 'a', cell(12, 5))).toBeNull(); // b's own cell
  });

  it('is empty on its own cell and null out of reach or on an obstacle', () => {
    const state = scene();
    expect(movePath(state, 'a', cell(10, 5))).toEqual([]);
    expect(movePath(state, 'a', cell(10, 9))).toBeNull(); // 4 cells, 3 MP
    expect(movePath(teleport(state, 'a', cell(15, 2)), 'a', ROCK)).toBeNull();
  });
});
