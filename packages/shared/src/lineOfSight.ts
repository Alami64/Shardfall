import { cellToGrid, gridToCell } from './grid.js';

/**
 * Cells crossed by the straight line between two cell centres, in grid space,
 * excluding both ends. Each grid cell is a unit square centred on its integer
 * coordinates. When the line passes exactly through a corner, both cells that
 * meet at that corner are returned as a pair, since the line only grazes them.
 */
export function cellsOnLine(from: number, to: number): Array<number | [number, number]> {
  const a = cellToGrid(from);
  const b = cellToGrid(to);
  const nx = Math.abs(b.x - a.x);
  const ny = Math.abs(b.y - a.y);
  const sx = Math.sign(b.x - a.x);
  const sy = Math.sign(b.y - a.y);
  let x = a.x;
  let y = a.y;
  let ix = 0;
  let iy = 0;
  const out: Array<number | [number, number]> = [];

  while (ix < nx || iy < ny) {
    const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    if (decision === 0) {
      // Exact corner: the line grazes the two side cells, then enters the diagonal one.
      out.push([gridToCell(x + sx, y), gridToCell(x, y + sy)]);
      x += sx;
      y += sy;
      ix++;
      iy++;
    } else if (decision < 0) {
      x += sx;
      ix++;
    } else {
      y += sy;
      iy++;
    }
    if (x === b.x && y === b.y) break;
    out.push(gridToCell(x, y));
  }
  return out;
}

/**
 * True when nothing blocks the line between two cells. The target cell itself
 * never blocks (you can always aim at the unit or obstacle you are looking at).
 * At an exact corner the line is only blocked if both grazed cells block.
 * Cells outside the map (-1) never block.
 */
export function hasLineOfSight(
  from: number,
  to: number,
  blocks: (cell: number) => boolean,
): boolean {
  const block = (c: number) => c !== -1 && blocks(c);
  for (const step of cellsOnLine(from, to)) {
    if (Array.isArray(step)) {
      if (block(step[0]) && block(step[1])) return false;
    } else if (block(step)) {
      return false;
    }
  }
  return true;
}
