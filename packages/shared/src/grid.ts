/**
 * Isometric grid math.
 *
 * A map is a staggered isometric grid: 14 cells per line and 40 lines, where every
 * odd line is shifted half a tile to the right. That gives 560 cells, numbered
 * left to right, top to bottom (cell id = line * MAP_WIDTH + column).
 *
 *   line 0:  0   1   2  ...  13
 *   line 1:    14  15  16 ...  27
 *   line 2:  28  29  30  ...  41
 *
 * Gameplay (range, areas, pathfinding, line of sight) uses diamond "grid"
 * coordinates where each axis follows one diagonal of the screen:
 *   +x = one step down-right on screen, +y = one step up-right on screen.
 * Moving along x or y is an orthogonal grid step (what combat movement allows);
 * changing both x and y by one is a diagonal grid step (screen-horizontal or
 * screen-vertical), allowed out of combat only.
 */

export const MAP_WIDTH = 14;
export const MAP_LINES = 40;
export const CELL_COUNT = MAP_WIDTH * MAP_LINES; // 560

/** Tile footprint in pixels: a 2:1 diamond. */
export const TILE_W = 86;
export const TILE_H = 43;
export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;

/** Pixel size of the full map footprint (without objects that stick out above). */
export const MAP_PIXEL_W = MAP_WIDTH * TILE_W + HALF_W;
export const MAP_PIXEL_H = (MAP_LINES + 1) * HALF_H;

export interface GridPos {
  x: number;
  y: number;
}

export interface ScreenPos {
  sx: number;
  sy: number;
}

export const isValidCell = (id: number): boolean =>
  Number.isInteger(id) && id >= 0 && id < CELL_COUNT;

export function cellLine(id: number): number {
  return Math.floor(id / MAP_WIDTH);
}

export function cellColumn(id: number): number {
  return id % MAP_WIDTH;
}

export function cellToGrid(id: number): GridPos {
  const line = cellLine(id);
  const col = cellColumn(id);
  return { x: col + Math.ceil(line / 2), y: col - Math.floor(line / 2) };
}

/** Returns the cell at grid coordinates, or -1 when they fall outside the map. */
export function gridToCell(x: number, y: number): number {
  const line = x - y;
  if (line < 0 || line >= MAP_LINES) return -1;
  const twiceCol = x + y - (line & 1);
  if (twiceCol & 1) return -1; // unreachable for integer inputs, kept as a guard
  const col = twiceCol / 2;
  if (col < 0 || col >= MAP_WIDTH) return -1;
  return line * MAP_WIDTH + col;
}

/** Centre of a cell's diamond, in map pixels (origin = top-left of the map footprint). */
export function cellToScreen(id: number): ScreenPos {
  const line = cellLine(id);
  const col = cellColumn(id);
  return {
    sx: col * TILE_W + (line & 1) * HALF_W + HALF_W,
    sy: line * HALF_H + HALF_H,
  };
}

/**
 * The cell whose diamond contains a map-pixel point, or -1 outside the map.
 * Inverts cellToScreen: centre (sx, sy) satisfies x + y = (sx - HALF_W) / HALF_W
 * and x - y = (sy - HALF_H) / HALF_H; rounding x and y independently picks the
 * diamond the point lies in.
 */
export function screenToCell(sx: number, sy: number): number {
  const u = (sx - HALF_W) / HALF_W;
  const v = (sy - HALF_H) / HALF_H;
  const x = Math.round((u + v) / 2);
  const y = Math.round((u - v) / 2);
  return gridToCell(x, y);
}

/** Manhattan distance in grid space: the number of orthogonal steps between two cells. */
export function distance(a: number, b: number): number {
  const p = cellToGrid(a);
  const q = cellToGrid(b);
  return Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
}

/** Orthogonal grid steps (combat movement), in a fixed order: +x, -x, +y, -y. */
export const ORTHOGONAL_STEPS: readonly GridPos[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/** Diagonal grid steps: screen right, left, down, up. */
export const DIAGONAL_STEPS: readonly GridPos[] = [
  { x: 1, y: 1 },
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
];

export function neighbors(id: number, diagonals = false): number[] {
  const { x, y } = cellToGrid(id);
  const steps = diagonals ? [...ORTHOGONAL_STEPS, ...DIAGONAL_STEPS] : ORTHOGONAL_STEPS;
  const out: number[] = [];
  for (const s of steps) {
    const n = gridToCell(x + s.x, y + s.y);
    if (n !== -1) out.push(n);
  }
  return out;
}

/** Eight facing directions on screen, numbered clockwise from screen-right. */
export enum Direction {
  East = 0, // screen right (diagonal grid step +x +y)
  SouthEast = 1, // down-right (orthogonal step +x)
  South = 2, // screen down (diagonal step +x -y)
  SouthWest = 3, // down-left (orthogonal step -y)
  West = 4, // screen left (diagonal step -x -y)
  NorthWest = 5, // up-left (orthogonal step -x)
  North = 6, // screen up (diagonal step -x +y)
  NorthEast = 7, // up-right (orthogonal step +y)
}

/** Direction of travel from one cell to an adjacent (or any) cell, from screen positions. */
export function directionBetween(from: number, to: number): Direction {
  const a = cellToScreen(from);
  const b = cellToScreen(to);
  // Scale vertical by 2 so isometric diagonals land on 45 degree boundaries.
  const angle = Math.atan2((b.sy - a.sy) * 2, b.sx - a.sx);
  const octant = Math.round(angle / (Math.PI / 4));
  return (((octant % 8) + 8) % 8) as Direction;
}

/** Which edge of the map a cell touches, used for map-to-map transitions. */
export type Edge = 'north' | 'south' | 'east' | 'west';

export function cellEdges(id: number): Edge[] {
  const line = cellLine(id);
  const col = cellColumn(id);
  const edges: Edge[] = [];
  if (line <= 1) edges.push('north');
  if (line >= MAP_LINES - 2) edges.push('south');
  if (col === 0 && (line & 1) === 0) edges.push('west');
  if (col === MAP_WIDTH - 1 && (line & 1) === 1) edges.push('east');
  return edges;
}
