import { cellToGrid, distance, gridToCell, type GridPos } from './grid.js';
import type { Zone } from './spell.js';

/**
 * Orthogonal grid direction from `from` towards `to`, used to orient line and
 * cone areas away from the caster: the axis with the larger gap wins. On a tie
 * (an exact diagonal, or casting on one's own cell) the x axis is used, +x when
 * there is no gap at all.
 */
export function castDirection(from: number, to: number): GridPos {
  const a = cellToGrid(from);
  const b = cellToGrid(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dy) > Math.abs(dx)) return { x: 0, y: Math.sign(dy) };
  return { x: dx < 0 ? -1 : 1, y: 0 };
}

/**
 * Cells covered by an area centred on `center`, cast from `from`, in grid space.
 * `size` counts cells beyond the centre:
 *   single  the centre only
 *   circle  Manhattan distance <= size
 *   ring    Manhattan distance == size
 *   square  both axis gaps <= size
 *   cross   the centre and `size` cells along each grid axis
 *   line    the centre and `size` cells further away from the caster
 *   cone    widens by one cell per side for each step away from the caster
 * Cells off the map are dropped. The centre comes first, then cells by distance
 * from it, ties by cell id, so effects resolve in a fixed order.
 */
export function zoneCells(zone: Zone, center: number, from: number): number[] {
  const c = cellToGrid(center);
  const n = zone.size;
  const out: number[] = [];
  const add = (x: number, y: number) => {
    const id = gridToCell(x, y);
    if (id !== -1) out.push(id);
  };

  switch (zone.shape) {
    case 'single':
      add(c.x, c.y);
      break;
    case 'circle':
    case 'ring':
    case 'square':
      for (let dx = -n; dx <= n; dx++) {
        for (let dy = -n; dy <= n; dy++) {
          const d = Math.abs(dx) + Math.abs(dy);
          if (zone.shape === 'circle' && d > n) continue;
          if (zone.shape === 'ring' && d !== n) continue;
          add(c.x + dx, c.y + dy);
        }
      }
      break;
    case 'cross':
      add(c.x, c.y);
      for (let k = 1; k <= n; k++) {
        add(c.x + k, c.y);
        add(c.x - k, c.y);
        add(c.x, c.y + k);
        add(c.x, c.y - k);
      }
      break;
    case 'line':
    case 'cone': {
      const dir = castDirection(from, center);
      const side = { x: dir.y === 0 ? 0 : 1, y: dir.x === 0 ? 0 : 1 };
      for (let k = 0; k <= n; k++) {
        const width = zone.shape === 'cone' ? k : 0;
        for (let w = -width; w <= width; w++) {
          add(c.x + k * dir.x + w * side.x, c.y + k * dir.y + w * side.y);
        }
      }
      break;
    }
  }
  return out.sort((a, b) => distance(center, a) - distance(center, b) || a - b);
}
