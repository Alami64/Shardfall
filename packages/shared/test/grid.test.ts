import { describe, expect, it } from 'vitest';
import {
  CELL_COUNT,
  Direction,
  HALF_H,
  HALF_W,
  MAP_LINES,
  MAP_WIDTH,
  cellEdges,
  cellToGrid,
  cellToScreen,
  directionBetween,
  distance,
  gridToCell,
  neighbors,
  screenToCell,
} from '../src/index.js';

describe('cell <-> grid coordinates', () => {
  it('round-trips every cell', () => {
    for (let c = 0; c < CELL_COUNT; c++) {
      const { x, y } = cellToGrid(c);
      expect(gridToCell(x, y)).toBe(c);
    }
  });

  it('gives every cell unique grid coordinates', () => {
    const seen = new Set<string>();
    for (let c = 0; c < CELL_COUNT; c++) {
      const { x, y } = cellToGrid(c);
      seen.add(`${x},${y}`);
    }
    expect(seen.size).toBe(CELL_COUNT);
  });

  it('rejects coordinates outside the map', () => {
    expect(gridToCell(-1, 0)).toBe(-1);
    expect(gridToCell(0, 1)).toBe(-1); // line -1
    expect(gridToCell(100, 0)).toBe(-1);
  });

  it('matches the documented layout for the first lines', () => {
    expect(cellToGrid(0)).toEqual({ x: 0, y: 0 });
    expect(cellToGrid(1)).toEqual({ x: 1, y: 1 });
    expect(cellToGrid(14)).toEqual({ x: 1, y: 0 }); // line 1 col 0, down-right of cell 0
    expect(cellToGrid(28)).toEqual({ x: 1, y: -1 }); // line 2 col 0, directly below cell 0
  });
});

describe('screen coordinates', () => {
  it('maps cell centres back to the same cell', () => {
    for (let c = 0; c < CELL_COUNT; c++) {
      const { sx, sy } = cellToScreen(c);
      expect(screenToCell(sx, sy)).toBe(c);
    }
  });

  it('picks the right cell near the inside of each diamond corner', () => {
    const inset = 0.8; // 80% of the way from centre to each tip stays inside the diamond
    for (let c = 0; c < CELL_COUNT; c++) {
      const { sx, sy } = cellToScreen(c);
      expect(screenToCell(sx + HALF_W * inset * 0.5, sy + HALF_H * inset * 0.5)).toBe(c);
      expect(screenToCell(sx - HALF_W * inset, sy)).toBe(c);
      expect(screenToCell(sx, sy - HALF_H * inset)).toBe(c);
    }
  });

  it('places orthogonal neighbours half a tile away on both axes', () => {
    const c = gridToCell(10, 0);
    const n = gridToCell(11, 0);
    const a = cellToScreen(c);
    const b = cellToScreen(n);
    expect(b.sx - a.sx).toBe(HALF_W);
    expect(b.sy - a.sy).toBe(HALF_H);
  });

  it('returns -1 outside the map', () => {
    expect(screenToCell(-50, -50)).toBe(-1);
    expect(screenToCell(5000, 100)).toBe(-1);
  });
});

describe('distance and neighbours', () => {
  it('measures Manhattan distance in grid steps', () => {
    expect(distance(0, 0)).toBe(0);
    expect(distance(0, 14)).toBe(1);
    expect(distance(0, 1)).toBe(2); // screen-right is a diagonal: 2 orthogonal steps
    expect(distance(0, 28)).toBe(2);
  });

  it('gives interior cells 4 or 8 neighbours and never wraps', () => {
    const mid = 20 * MAP_WIDTH + 6;
    expect(neighbors(mid)).toHaveLength(4);
    expect(neighbors(mid, true)).toHaveLength(8);
    for (let c = 0; c < CELL_COUNT; c++) {
      for (const n of neighbors(c, true)) {
        const a = cellToScreen(c);
        const b = cellToScreen(n);
        expect(Math.abs(a.sx - b.sx)).toBeLessThanOrEqual(2 * HALF_W);
        expect(Math.abs(a.sy - b.sy)).toBeLessThanOrEqual(2 * HALF_H);
      }
    }
  });

  it('gives the top-left corner cell only in-map neighbours', () => {
    expect(neighbors(0).sort((a, b) => a - b)).toEqual([14]);
  });
});

describe('directions and edges', () => {
  it('names the eight screen directions', () => {
    const c = gridToCell(15, 0);
    const at = (dx: number, dy: number) => directionBetween(c, gridToCell(15 + dx, dy));
    expect(at(1, 1)).toBe(Direction.East);
    expect(at(1, 0)).toBe(Direction.SouthEast);
    expect(at(1, -1)).toBe(Direction.South);
    expect(at(0, -1)).toBe(Direction.SouthWest);
    expect(at(-1, -1)).toBe(Direction.West);
    expect(at(-1, 0)).toBe(Direction.NorthWest);
    expect(at(-1, 1)).toBe(Direction.North);
    expect(at(0, 1)).toBe(Direction.NorthEast);
  });

  it('finds edge cells', () => {
    expect(cellEdges(5)).toContain('north');
    expect(cellEdges((MAP_LINES - 1) * MAP_WIDTH + 3)).toContain('south');
    expect(cellEdges(2 * MAP_WIDTH)).toContain('west');
    expect(cellEdges(MAP_WIDTH * 3 + MAP_WIDTH - 1)).toContain('east');
    expect(cellEdges(20 * MAP_WIDTH + 6)).toEqual([]);
  });
});
