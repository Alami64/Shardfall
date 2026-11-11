// The map grid. Cells are stored in staggered rows (col, row); gameplay uses
// diamond coordinates (u, v), where u runs down-right and v runs down-left on screen.
export const COLS = 14;
export const ROWS = 31;
export const CELLS = COLS * ROWS;
export const TW = 64;
export const TH = 32;
export const OX = 16;
export const OY = 44;
export const VIEW_W = 960;
export const VIEW_H = 560;

export const colOf = (i: number) => i % COLS;
export const rowOf = (i: number) => (i / COLS) | 0;
export const cellAt = (c: number, r: number) => (c < 0 || c >= COLS || r < 0 || r >= ROWS ? -1 : r * COLS + c);

export function uv(i: number): [number, number] {
  const r = rowOf(i), c = colOf(i), o = r & 1;
  return [(r + 2 * c + o) / 2, (r - 2 * c - o) / 2];
}

export function fromUV(u: number, v: number): number {
  const r = u + v;
  if (r < 0 || r >= ROWS) return -1;
  const c = (u - v - (r & 1)) / 2;
  if (c < 0 || c >= COLS) return -1;
  return r * COLS + c;
}

/** Screen position of a cell's centre. Drawing only. */
export function center(i: number): { x: number; y: number } {
  const r = rowOf(i), c = colOf(i);
  return { x: OX + c * TW + (r & 1) * (TW / 2) + TW / 2, y: OY + r * (TH / 2) + TH / 2 };
}

/** Cell under a screen point, or -1. */
export function pickCell(px: number, py: number): number {
  const a = (px - OX - TW / 2) / (TW / 2);
  const b = (py - OY - TH / 2) / (TH / 2);
  return fromUV(Math.round((a + b) / 2), Math.round((b - a) / 2));
}

export function dist(a: number, b: number): number {
  const [ua, va] = uv(a), [ub, vb] = uv(b);
  return Math.abs(ua - ub) + Math.abs(va - vb);
}

export function inLine(a: number, b: number): boolean {
  const [ua, va] = uv(a), [ub, vb] = uv(b);
  return ua === ub || va === vb;
}

export const DIRS4: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export const DIRS8: [number, number][] = [...DIRS4, [1, 1], [1, -1], [-1, 1], [-1, -1]];

export function neighbors(i: number): number[] {
  const [u, v] = uv(i);
  const out: number[] = [];
  for (const [du, dv] of DIRS4) {
    const n = fromUV(u + du, v + dv);
    if (n >= 0) out.push(n);
  }
  return out;
}

export type AreaShape = 'circle' | 'ring';

/** Cells of an area centred on a cell. A ring leaves the centre out. */
export function areaCells(centerCell: number, shape: AreaShape, size: number): number[] {
  const [u, v] = uv(centerCell);
  const out: number[] = [];
  for (let du = -size; du <= size; du++) {
    for (let dv = -size; dv <= size; dv++) {
      const d = Math.abs(du) + Math.abs(dv);
      if (d > size || (shape === 'ring' && d === 0)) continue;
      const n = fromUV(u + du, v + dv);
      if (n >= 0) out.push(n);
    }
  }
  return out;
}

/** One step from a towards b along the stronger axis (used by pushback). */
export function stepAway(from: number, target: number): [number, number] {
  const [uf, vf] = uv(from), [ut, vt] = uv(target);
  const du = ut - uf, dv = vt - vf;
  if (Math.abs(du) >= Math.abs(dv)) return [Math.sign(du) || 1, 0];
  return [0, Math.sign(dv)];
}
