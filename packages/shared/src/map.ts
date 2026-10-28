import { CELL_COUNT, MAP_LINES, MAP_WIDTH, cellEdges, type Edge } from './grid.js';

/** Bit flags stored per cell. */
export const CellFlag = {
  Walkable: 1 << 0,
  BlocksLineOfSight: 1 << 1,
  StartTeamA: 1 << 2,
  StartTeamB: 1 << 3,
  Interactive: 1 << 4,
} as const;

/**
 * A map as the game reads it, produced from a Tiled file by the map converter.
 * Arrays are indexed by cell id (0..559).
 */
export interface GameMap {
  id: string;
  name: string;
  /** Position on the world map; neighbours are found by coordinates. */
  worldX: number;
  worldY: number;
  width: typeof MAP_WIDTH;
  lines: typeof MAP_LINES;
  /** Ground tile key per cell (an index into `tiles`). */
  ground: number[];
  /** Object tile key per cell (an index into `tiles`), or -1 for none. */
  objects: number[];
  /** CellFlag bits per cell. */
  flags: number[];
  /** Tile keys referenced by `ground` and `objects`, e.g. "grass_1", "tree_oak". */
  tiles: string[];
}

export interface WorldData {
  maps: GameMap[];
}

export const hasFlag = (map: GameMap, cell: number, flag: number): boolean =>
  ((map.flags[cell] ?? 0) & flag) !== 0;

export const isWalkable = (map: GameMap, cell: number): boolean =>
  hasFlag(map, cell, CellFlag.Walkable);

export const blocksLineOfSight = (map: GameMap, cell: number): boolean =>
  hasFlag(map, cell, CellFlag.BlocksLineOfSight);

export function mapKey(worldX: number, worldY: number): string {
  return `${worldX},${worldY}`;
}

/** World-coordinate offset of the neighbouring map across each edge. */
export const EDGE_OFFSET: Record<Edge, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

export const OPPOSITE_EDGE: Record<Edge, Edge> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

/** Walkable cells on one edge of a map, in cell order. */
export function edgeCells(map: GameMap, edge: Edge): number[] {
  const out: number[] = [];
  for (let c = 0; c < CELL_COUNT; c++) {
    if (isWalkable(map, c) && cellEdges(c).includes(edge)) out.push(c);
  }
  return out;
}

/** Basic structural check, used by the converter and in tests. */
export function validateMap(map: GameMap): string[] {
  const errors: string[] = [];
  if (map.width !== MAP_WIDTH) errors.push(`width must be ${MAP_WIDTH}`);
  if (map.lines !== MAP_LINES) errors.push(`lines must be ${MAP_LINES}`);
  for (const key of ['ground', 'objects', 'flags'] as const) {
    if (map[key].length !== CELL_COUNT) errors.push(`${key} must have ${CELL_COUNT} entries`);
  }
  map.ground.forEach((t, i) => {
    if (t < 0 || t >= map.tiles.length) errors.push(`cell ${i}: ground tile ${t} out of range`);
  });
  map.objects.forEach((t, i) => {
    if (t < -1 || t >= map.tiles.length) errors.push(`cell ${i}: object tile ${t} out of range`);
  });
  return errors;
}
