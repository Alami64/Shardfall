import { DIRS4, DIRS8, fromUV, uv, CELLS } from './grid.js';

/**
 * Shortest path by breadth-first search to the nearest cell accepted by isGoal.
 * Returns the cells to step on (start left out), or null.
 */
export function findPath(
  start: number,
  isGoal: (i: number) => boolean,
  pass: (i: number) => boolean,
  diagonals = false,
): number[] | null {
  if (isGoal(start)) return [];
  const prev = new Int32Array(CELLS).fill(-2);
  prev[start] = -1;
  const queue = [start];
  const dirs = diagonals ? DIRS8 : DIRS4;
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q]!;
    const [u, v] = uv(cur);
    for (const [du, dv] of dirs) {
      const n = fromUV(u + du, v + dv);
      if (n < 0 || prev[n] !== -2 || !pass(n)) continue;
      if (du !== 0 && dv !== 0) {
        // No squeezing between two blocked corners.
        const a = fromUV(u + du, v), b = fromUV(u, v + dv);
        if (!((a >= 0 && pass(a)) || (b >= 0 && pass(b)))) continue;
      }
      prev[n] = cur;
      if (isGoal(n)) {
        const path: number[] = [];
        for (let c = n; c !== start; c = prev[c]!) path.push(c);
        return path.reverse();
      }
      queue.push(n);
    }
  }
  return null;
}

/** Every cell reachable within mp orthogonal steps, with the path to it. */
export function reachable(start: number, mp: number, pass: (i: number) => boolean): Map<number, number[]> {
  const out = new Map<number, number[]>();
  let frontier: [number, number[]][] = [[start, []]];
  const seen = new Set<number>([start]);
  for (let step = 0; step < mp; step++) {
    const next: [number, number[]][] = [];
    for (const [cell, path] of frontier) {
      const [u, v] = uv(cell);
      for (const [du, dv] of DIRS4) {
        const n = fromUV(u + du, v + dv);
        if (n < 0 || seen.has(n) || !pass(n)) continue;
        seen.add(n);
        const p = [...path, n];
        out.set(n, p);
        next.push([n, p]);
      }
    }
    frontier = next;
  }
  return out;
}

/** Line of sight between two cells; the end cells themselves never block. */
export function hasLos(a: number, b: number, blocks: (i: number) => boolean): boolean {
  if (a === b) return true;
  if (a > b) [a, b] = [b, a];
  const [ua, va] = uv(a), [ub, vb] = uv(b);
  const du = ub - ua, dv = vb - va;
  const steps = (Math.abs(du) + Math.abs(dv)) * 4;
  let last = -1;
  for (let k = 1; k < steps; k++) {
    const t = k / steps;
    const c = fromUV(Math.round(ua + du * t + 1e-6), Math.round(va + dv * t + 1e-6));
    if (c < 0 || c === last || c === a || c === b) continue;
    last = c;
    if (blocks(c)) return false;
  }
  return true;
}
