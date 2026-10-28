import { describe, expect, it } from 'vitest';
import {
  CELL_COUNT,
  cellToGrid,
  distance,
  findPath,
  gridToCell,
  hasLineOfSight,
  neighbors,
  reachableCells,
} from '../src/index.js';

const open = () => true;
const cell = (x: number, y: number) => {
  const c = gridToCell(x, y);
  if (c === -1) throw new Error(`(${x}, ${y}) is outside the map`);
  return c;
};

/** Checks that every step of a path moves to an adjacent cell. */
function expectContiguous(from: number, path: number[], diagonals: boolean) {
  let prev = from;
  for (const c of path) {
    expect(neighbors(prev, diagonals)).toContain(c);
    prev = c;
  }
}

describe('findPath, combat movement (orthogonal)', () => {
  it('returns an empty path when already there', () => {
    expect(findPath(100, 100, open)).toEqual([]);
  });

  it('takes the Manhattan distance on an open map', () => {
    for (const [a, b] of [
      [cell(5, 0), cell(12, 3)],
      [cell(20, 0), cell(10, -5)],
      [cell(3, 3), cell(25, 0)],
    ] as const) {
      const path = findPath(a, b, open)!;
      expect(path).toHaveLength(distance(a, b));
      expect(path.at(-1)).toBe(b);
      expectContiguous(a, path, false);
    }
  });

  it('walks around a wall', () => {
    const from = cell(10, 0);
    const to = cell(14, 0);
    // A wall across the straight route at x = 12, from y = -3 to y = 3.
    const wall = new Set<number>();
    for (let y = -3; y <= 3; y++) wall.add(cell(12, y));
    const path = findPath(from, to, (c) => !wall.has(c))!;
    expect(path).not.toBeNull();
    expect(path.some((c) => wall.has(c))).toBe(false);
    expectContiguous(from, path, false);
    expect(path.length).toBeGreaterThan(distance(from, to));
  });

  it('returns null when the goal is enclosed', () => {
    const goal = cell(14, 0);
    const ring = new Set(neighbors(goal));
    expect(findPath(cell(5, 0), goal, (c) => !ring.has(c))).toBeNull();
  });

  it('returns null for an unwalkable goal unless allowed', () => {
    const goal = cell(14, 0);
    const walk = (c: number) => c !== goal;
    expect(findPath(cell(10, 0), goal, walk)).toBeNull();
    expect(findPath(cell(10, 0), goal, walk, { allowGoalBlocked: true })?.at(-1)).toBe(goal);
  });

  it('respects extra blockers and a step limit', () => {
    const from = cell(10, 0);
    const to = cell(13, 0);
    const unit = cell(11, 0);
    const path = findPath(from, to, open, { isBlocked: (c) => c === unit })!;
    expect(path).not.toContain(unit);
    expect(findPath(from, to, open, { maxSteps: 2 })).toBeNull();
    expect(findPath(from, to, open, { maxSteps: 3 })).toHaveLength(3);
  });
});

describe('findPath, exploration (with diagonals)', () => {
  it('walks straight across the screen with diagonal steps', () => {
    // Same line, 6 columns apart: 6 screen-horizontal steps, or 12 orthogonal ones.
    const from = 20 * 14 + 2;
    const to = 20 * 14 + 8;
    const path = findPath(from, to, open, { diagonals: true })!;
    expectContiguous(from, path, true);
    expect(path.at(-1)).toBe(to);
    expect(path.length).toBeLessThan(distance(from, to));
  });

  it('never cuts a corner between two blocked cells', () => {
    const c = cell(14, 0);
    const blocked = new Set([cell(15, 0), cell(14, 1)]);
    const path = findPath(c, cell(15, 1), (x) => !blocked.has(x), { diagonals: true });
    // The direct diagonal is closed, so the walker must go around (or fail), never squeeze through.
    if (path) expect(path.length).toBeGreaterThan(1);
  });

  it('finds a path between any two walkable cells of an open map', () => {
    for (let i = 0; i < 200; i++) {
      const a = (i * 97) % CELL_COUNT;
      const b = (i * 131 + 7) % CELL_COUNT;
      const path = findPath(a, b, open, { diagonals: true });
      expect(path).not.toBeNull();
      expectContiguous(a, path!, true);
    }
  });
});

describe('reachableCells', () => {
  it('matches the diamond of Manhattan radius on an open map', () => {
    const from = cell(15, 0);
    const reach = reachableCells(from, 3, open);
    for (const [c, d] of reach) expect(d).toBe(distance(from, c));
    // 2r(r+1) cells within radius r, minus the centre.
    expect(reach.size).toBe(2 * 3 * 4);
  });
});

describe('line of sight', () => {
  const from = cell(10, 0);
  const to = cell(16, 0);

  it('is clear on an open map', () => {
    expect(hasLineOfSight(from, to, () => false)).toBe(true);
  });

  it('is blocked by an obstacle on the line', () => {
    expect(hasLineOfSight(from, to, (c) => c === cell(13, 0))).toBe(false);
  });

  it('is not blocked by the target cell itself', () => {
    expect(hasLineOfSight(from, to, (c) => c === to)).toBe(true);
  });

  it('only blocks a corner-grazing line when both grazed cells block', () => {
    const a = cell(10, 0);
    const b = cell(12, 2); // exact diagonal: passes corners
    const g1 = cell(11, 0);
    const g2 = cell(10, 1);
    expect(hasLineOfSight(a, b, (c) => c === g1)).toBe(true);
    expect(hasLineOfSight(a, b, (c) => c === g1 || c === g2)).toBe(false);
  });

  it('is symmetric on random obstacle layouts', () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const blocks = new Set<number>();
    for (let c = 0; c < CELL_COUNT; c++) if (rand() < 0.15) blocks.add(c);
    const isBlock = (c: number) => blocks.has(c);
    for (let i = 0; i < 300; i++) {
      const a = Math.floor(rand() * CELL_COUNT);
      const b = Math.floor(rand() * CELL_COUNT);
      expect(hasLineOfSight(a, b, isBlock)).toBe(hasLineOfSight(b, a, isBlock));
    }
    // Sanity: the grid coordinates used above are valid.
    expect(cellToGrid(cell(12, 2))).toEqual({ x: 12, y: 2 });
  });
});
