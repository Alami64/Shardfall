import { CELL_COUNT, cellToGrid, cellToScreen, gridToCell, ORTHOGONAL_STEPS, DIAGONAL_STEPS, HALF_H, HALF_W } from './grid.js';

/**
 * Step costs in screen distance, normalised so an orthogonal grid step costs 1.
 * An orthogonal step moves (43, 21.5) px; a diagonal one moves 86 px across or
 * 43 px down, so their costs follow the on-screen distance the walker covers.
 */
const ORTHO_PX = Math.hypot(HALF_W, HALF_H);
const DIAG_H_COST = (2 * HALF_W) / ORTHO_PX; // screen-horizontal step, ~1.79
const DIAG_V_COST = (2 * HALF_H) / ORTHO_PX; // screen-vertical step, ~0.89

export interface PathOptions {
  /** Allow diagonal grid steps (exploration). Combat movement is orthogonal only. */
  diagonals?: boolean;
  /** Extra cells to treat as blocked, e.g. other units in a fight. */
  isBlocked?: (cell: number) => boolean;
  /** Maximum path length in steps (e.g. remaining MP). */
  maxSteps?: number;
  /** Let the path end on a blocked goal (used to walk up to an interactive object). */
  allowGoalBlocked?: boolean;
}

/** Binary min-heap keyed by f-score. */
class MinHeap {
  private items: number[] = [];
  constructor(private readonly score: Float64Array) {}
  get size(): number {
    return this.items.length;
  }
  push(cell: number): void {
    const a = this.items;
    a.push(cell);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.score[a[p]!]! <= this.score[a[i]!]!) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.score[a[l]!]! < this.score[a[m]!]!) m = l;
        if (r < a.length && this.score[a[r]!]! < this.score[a[m]!]!) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

/** Straight-line screen distance in orthogonal-step units: admissible for both movement modes. */
function heuristic(a: number, b: number): number {
  const p = cellToScreen(a);
  const q = cellToScreen(b);
  return Math.hypot(p.sx - q.sx, p.sy - q.sy) / ORTHO_PX;
}

/**
 * A* over the cell grid. Returns the cells to walk through, excluding `from` and
 * including `to`, or null when `to` cannot be reached. An empty array means
 * `from === to`.
 */
export function findPath(
  from: number,
  to: number,
  walkable: (cell: number) => boolean,
  options: PathOptions = {},
): number[] | null {
  if (from === to) return [];
  if (to < 0 || to >= CELL_COUNT) return null;
  const blocked = (c: number) => !walkable(c) || (options.isBlocked?.(c) ?? false);
  if (blocked(to) && !options.allowGoalBlocked) return null;

  const g = new Float64Array(CELL_COUNT).fill(Infinity);
  const f = new Float64Array(CELL_COUNT).fill(Infinity);
  const steps = new Int32Array(CELL_COUNT);
  const came = new Int32Array(CELL_COUNT).fill(-1);
  const closed = new Uint8Array(CELL_COUNT);
  const open = new MinHeap(f);

  g[from] = 0;
  f[from] = heuristic(from, to);
  open.push(from);

  while (open.size > 0) {
    const cur = open.pop();
    if (cur === to) return reconstruct(came, to);
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (options.maxSteps !== undefined && steps[cur]! >= options.maxSteps) continue;

    const { x, y } = cellToGrid(cur);
    const tryStep = (nx: number, ny: number, cost: number) => {
      const n = gridToCell(nx, ny);
      if (n === -1 || closed[n]) return;
      if (n !== to && blocked(n)) return; // the goal was already checked above
      const tentative = g[cur]! + cost;
      if (tentative < g[n]!) {
        g[n] = tentative;
        f[n] = tentative + heuristic(n, to);
        steps[n] = steps[cur]! + 1;
        came[n] = cur;
        open.push(n);
      }
    };

    for (const s of ORTHOGONAL_STEPS) tryStep(x + s.x, y + s.y, 1);
    if (options.diagonals) {
      for (const s of DIAGONAL_STEPS) {
        // No corner cutting: both orthogonal cells beside the diagonal must be free.
        const side1 = gridToCell(x + s.x, y);
        const side2 = gridToCell(x, y + s.y);
        if (side1 === -1 || side2 === -1 || blocked(side1) || blocked(side2)) continue;
        const cost = s.x === s.y ? DIAG_H_COST : DIAG_V_COST;
        tryStep(x + s.x, y + s.y, cost);
      }
    }
  }
  return null;
}

function reconstruct(came: Int32Array, to: number): number[] {
  const path: number[] = [];
  for (let c = to; came[c] !== -1; c = came[c]!) path.push(c);
  return path.reverse();
}

/**
 * Every cell reachable within `maxSteps` orthogonal steps (combat movement range),
 * mapped to its step count. Used to highlight where a unit can move this turn.
 */
export function reachableCells(
  from: number,
  maxSteps: number,
  walkable: (cell: number) => boolean,
  isBlocked: (cell: number) => boolean = () => false,
): Map<number, number> {
  const dist = new Map<number, number>([[from, 0]]);
  let frontier = [from];
  for (let d = 1; d <= maxSteps && frontier.length > 0; d++) {
    const next: number[] = [];
    for (const c of frontier) {
      const { x, y } = cellToGrid(c);
      for (const s of ORTHOGONAL_STEPS) {
        const n = gridToCell(x + s.x, y + s.y);
        if (n === -1 || dist.has(n) || !walkable(n) || isBlocked(n)) continue;
        dist.set(n, d);
        next.push(n);
      }
    }
    frontier = next;
  }
  dist.delete(from);
  return dist;
}
