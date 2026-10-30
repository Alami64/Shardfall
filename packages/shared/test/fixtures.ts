import {
  CELL_COUNT,
  CellFlag,
  createFight,
  createRng,
  fighterStats,
  gridToCell,
  startFight,
  type FightResult,
  type FightState,
  type FighterSetup,
  type FighterStats,
  type GameMap,
  type Spell,
  type SpellGrade,
  type Team,
} from '../src/index.js';

/** Test fixtures shared by the fight and spell tests. */

export const cell = (x: number, y: number) => {
  const c = gridToCell(x, y);
  if (c === -1) throw new Error(`(${x}, ${y}) is outside the map`);
  return c;
};

export const START = {
  A: [cell(10, 0), cell(10, 1), cell(11, 0)],
  B: [cell(20, 0), cell(20, 1), cell(21, 0)],
};
export const ROCK = cell(15, 1);

/** An open map with one blocked cell and the start cells above flagged. */
export function makeMap(): GameMap {
  const flags = new Array<number>(CELL_COUNT).fill(CellFlag.Walkable);
  flags[ROCK] = CellFlag.BlocksLineOfSight;
  for (const c of START.A) flags[c] = CellFlag.Walkable | CellFlag.StartTeamA;
  for (const c of START.B) flags[c] = CellFlag.Walkable | CellFlag.StartTeamB;
  return {
    id: 'test',
    name: 'Test',
    worldX: 0,
    worldY: 0,
    region: 'Test',
    width: 14,
    lines: 40,
    ground: new Array<number>(CELL_COUNT).fill(0),
    objects: new Array<number>(CELL_COUNT).fill(-1),
    flags,
    tiles: ['grass_1'],
  };
}

export const MAP = makeMap();

export function fighter(
  id: string,
  team: Team,
  initiative: number,
  extra: Partial<Omit<FighterSetup, 'stats'>> & { mp?: number; maxHp?: number; stats?: Partial<FighterStats> } = {},
): FighterSetup {
  const { mp = 3, maxHp = 100, stats = {}, ...rest } = extra;
  return {
    id,
    name: id,
    team,
    controller: 'player',
    stats: fighterStats({ maxHp, mp, initiative, ...stats }),
    ...rest,
  };
}

export function expectOk(r: FightResult): Extract<FightResult, { ok: true }> {
  if (!r.ok) throw new Error(`expected success, got ${r.error}`);
  return r;
}

export const create = (setups: FighterSetup[], seed = 1, spells: Spell[] = []) =>
  expectOk(createFight(MAP, setups, createRng(seed), { spells })).state;

/** A started fight; `a` (initiative 100) plays first, then `b`. */
export function started(
  setups: FighterSetup[] = [fighter('a', 'A', 100), fighter('b', 'B', 50)],
  seed = 1,
  spells: Spell[] = [],
) {
  return expectOk(startFight(create(setups, seed, spells), createRng(seed))).state;
}

/** Puts a fighter on a given cell, bypassing the rules, to set up a scenario. */
export function teleport(state: FightState, id: string, to: number): FightState {
  return { ...state, fighters: state.fighters.map((f) => (f.id === id ? { ...f, cell: to } : f)) };
}

/** A spell grade with neutral defaults: 3 AP, range 1-4, line of sight, no limits. */
export function grade(overrides: Partial<SpellGrade> = {}): SpellGrade {
  return {
    apCost: 3,
    minRange: 1,
    maxRange: 4,
    rangeBoostable: false,
    castInLine: false,
    castInDiagonal: false,
    needsLineOfSight: true,
    needsFreeCell: false,
    castsPerTurn: 0,
    castsPerTarget: 0,
    cooldown: 0,
    initialCooldown: 0,
    criticalChance: 0,
    effects: [],
    criticalEffects: [],
    ...overrides,
  };
}

export function spell(id: string, ...grades: SpellGrade[]): Spell {
  return { id, classId: 'test', name: id, unlockLevel: 1, pairId: id, grades: grades.length ? grades : [grade()] };
}
