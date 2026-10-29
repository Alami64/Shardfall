import { describe, expect, it } from 'vitest';
import { castDirection, cellToGrid, distance, neighbors, zoneCells, type Zone } from '../src/index.js';
import { cell } from './fixtures.js';

const CENTER = cell(12, 5);
const CASTER = cell(10, 5); // two steps along -x from the centre

const zone = (shape: Zone['shape'], size: number): Zone => ({ shape, size });
const coords = (cells: number[]) => cells.map((c) => cellToGrid(c)).map(({ x, y }) => `${x},${y}`).sort();

describe('castDirection', () => {
  it('follows the axis with the larger gap', () => {
    expect(castDirection(cell(10, 5), cell(13, 6))).toEqual({ x: 1, y: 0 });
    expect(castDirection(cell(10, 5), cell(9, 2))).toEqual({ x: 0, y: -1 });
  });

  it('falls back to the x axis on a diagonal, and +x on the caster itself', () => {
    expect(castDirection(cell(10, 5), cell(8, 3))).toEqual({ x: -1, y: 0 });
    expect(castDirection(cell(10, 5), cell(10, 5))).toEqual({ x: 1, y: 0 });
  });
});

describe('zoneCells', () => {
  it('treats size 0 as the centre for every shape', () => {
    for (const shape of ['single', 'circle', 'cross', 'line', 'cone', 'square', 'ring'] as const) {
      expect(zoneCells(zone(shape, 0), CENTER, CASTER)).toEqual([CENTER]);
    }
  });

  it('fills a Manhattan circle', () => {
    const cells = zoneCells(zone('circle', 2), CENTER, CASTER);
    expect(cells).toHaveLength(13);
    expect(cells.every((c) => distance(CENTER, c) <= 2)).toBe(true);
  });

  it('keeps only the edge for a ring', () => {
    const cells = zoneCells(zone('ring', 2), CENTER, CASTER);
    expect(cells).toHaveLength(8);
    expect(cells.every((c) => distance(CENTER, c) === 2)).toBe(true);
  });

  it('includes grid diagonals in a square', () => {
    expect(coords(zoneCells(zone('square', 1), CENTER, CASTER))).toEqual(
      ['11,4', '11,5', '11,6', '12,4', '12,5', '12,6', '13,4', '13,5', '13,6'].sort(),
    );
  });

  it('runs a cross along both grid axes', () => {
    expect(coords(zoneCells(zone('cross', 2), CENTER, CASTER))).toEqual(
      ['10,5', '11,5', '12,5', '13,5', '14,5', '12,3', '12,4', '12,6', '12,7'].sort(),
    );
  });

  it('extends a line away from the caster', () => {
    expect(coords(zoneCells(zone('line', 2), CENTER, CASTER))).toEqual(['12,5', '13,5', '14,5']);
    // Cast from the other side, the line runs the other way.
    expect(coords(zoneCells(zone('line', 2), CENTER, cell(12, 8)))).toEqual(['12,3', '12,4', '12,5']);
  });

  it('widens a cone by one cell per side for each step', () => {
    expect(coords(zoneCells(zone('cone', 2), CENTER, CASTER))).toEqual(
      ['12,5', '13,4', '13,5', '13,6', '14,3', '14,4', '14,5', '14,6', '14,7'].sort(),
    );
  });

  it('drops cells off the map', () => {
    expect(zoneCells(zone('circle', 1), 0, 0)).toHaveLength(neighbors(0).length + 1);
  });

  it('lists the centre first, then cells by distance from it', () => {
    const cells = zoneCells(zone('circle', 2), CENTER, CASTER);
    expect(cells[0]).toBe(CENTER);
    const d = cells.map((c) => distance(CENTER, c));
    expect(d).toEqual([...d].sort((a, b) => a - b));
  });
});
