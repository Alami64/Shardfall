// Small square icons for spells and items, drawn in code and cached as data URLs.
const cache = new Map<string, string>();

type C = CanvasRenderingContext2D;

function stroke(c: C, pts: number[], color: string, lw: number) {
  c.beginPath();
  c.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i]!, pts[i + 1]!);
  c.strokeStyle = color; c.lineWidth = lw; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
}
function fill(c: C, pts: number[], color: string) {
  c.beginPath();
  c.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i]!, pts[i + 1]!);
  c.closePath(); c.fillStyle = color; c.fill();
}
function dot(c: C, x: number, y: number, r: number, color: string) {
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = color; c.fill();
}

const DRAW: Record<string, (c: C, col: string) => void> = {
  slash(c, col) {
    c.beginPath(); c.arc(8, 34, 26, -Math.PI * 0.48, -Math.PI * 0.04); c.strokeStyle = col; c.lineWidth = 5; c.lineCap = 'round'; c.stroke();
    c.beginPath(); c.arc(4, 38, 22, -Math.PI * 0.46, -Math.PI * 0.08); c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 2; c.stroke();
  },
  flame(c, col) {
    c.beginPath(); c.moveTo(20, 5); c.bezierCurveTo(32, 16, 31, 34, 20, 35); c.bezierCurveTo(9, 34, 8, 20, 15, 14); c.bezierCurveTo(16, 19, 19, 18, 20, 5);
    c.fillStyle = col; c.fill();
    c.beginPath(); c.moveTo(20, 18); c.bezierCurveTo(26, 24, 25, 32, 20, 32); c.bezierCurveTo(15, 32, 15, 26, 20, 18); c.fillStyle = '#ffe9a8'; c.fill();
  },
  step(c, col) {
    stroke(c, [8, 28, 16, 20, 8, 12], 'rgba(255,255,255,.4)', 4);
    stroke(c, [18, 28, 26, 20, 18, 12], col, 4.5);
    dot(c, 32, 20, 3, col);
  },
  snare(c, col) { fill(c, [23, 4, 10, 22, 19, 22, 15, 36, 30, 16, 21, 16], col); },
  heart(c, col) {
    c.beginPath(); c.moveTo(20, 33); c.bezierCurveTo(2, 20, 8, 6, 20, 14); c.bezierCurveTo(32, 6, 38, 20, 20, 33); c.fillStyle = col; c.fill();
    stroke(c, [20, 17, 20, 27], '#fff', 3); stroke(c, [15, 22, 25, 22], '#fff', 3);
  },
  ring(c, col) {
    c.beginPath(); c.arc(20, 20, 12, 0, Math.PI * 2); c.strokeStyle = col; c.lineWidth = 4; c.stroke();
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.6; stroke(c, [20 + Math.cos(a) * 14, 20 + Math.sin(a) * 14, 20 + Math.cos(a) * 18, 20 + Math.sin(a) * 18], '#fff', 2.5); }
    dot(c, 20, 20, 3, '#fff');
  },
  trance(c, col) {
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, r = k % 2 ? 9 : 15; stroke(c, [20, 20, 20 + Math.cos(a) * r, 20 + Math.sin(a) * r], col, 3.5); }
    dot(c, 20, 20, 4.5, '#fff');
  },
  hammer(c, col) {
    stroke(c, [10, 32, 24, 16], '#8a6a4a', 4);
    c.save(); c.translate(26, 13); c.rotate(-Math.PI / 4); c.fillStyle = col; c.fillRect(-10, -6, 20, 12); c.restore();
  },
  meteor(c, col) {
    stroke(c, [8, 8, 20, 20], 'rgba(255,255,255,.45)', 3); stroke(c, [16, 6, 24, 16], 'rgba(255,255,255,.3)', 2.5); stroke(c, [6, 16, 16, 24], 'rgba(255,255,255,.3)', 2.5);
    dot(c, 25, 26, 8, col); dot(c, 23, 24, 3, '#ffe9a8');
  },
  leech(c, col) {
    c.beginPath(); c.arc(16, 22, 13, -Math.PI * 0.5, Math.PI * 0.35); c.strokeStyle = '#e8d9b5'; c.lineWidth = 4; c.lineCap = 'round'; c.stroke();
    c.beginPath(); c.moveTo(27, 8); c.bezierCurveTo(35, 20, 33, 28, 27, 28); c.bezierCurveTo(21, 28, 19, 20, 27, 8); c.fillStyle = col; c.fill();
  },
  fist(c, col) {
    c.fillStyle = col; c.beginPath(); c.roundRect(10, 14, 20, 16, 5); c.fill();
    for (const x of [12.5, 17.5, 22.5, 27.5]) dot(c, x, 13, 3, col);
    stroke(c, [14, 22, 26, 22], 'rgba(0,0,0,.3)', 1.5);
  },
  weapon(c, col) {
    stroke(c, [10, 30, 29, 9], col, 5); stroke(c, [12, 28, 28, 10], 'rgba(255,255,255,.55)', 1.5);
    stroke(c, [8, 24, 16, 32], '#c9a24a', 4); stroke(c, [7, 33, 10, 30], '#7a5536', 4);
  },
  helm(c, col) {
    c.beginPath(); c.arc(20, 22, 12, Math.PI, 0); c.lineTo(32, 30); c.lineTo(8, 30); c.closePath(); c.fillStyle = col; c.fill();
    c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(13, 22, 14, 4);
    stroke(c, [20, 10, 20, 5], col, 3);
  },
  cloak(c, col) {
    fill(c, [13, 8, 27, 8, 33, 33, 20, 29, 7, 33], col);
    stroke(c, [13, 9, 27, 9], '#e3bd55', 3);
  },
  amulet(c, col) {
    c.beginPath(); c.arc(20, 12, 10, 0.15 * Math.PI, 0.85 * Math.PI); c.strokeStyle = '#c9a24a'; c.lineWidth = 2; c.stroke();
    fill(c, [20, 19, 27, 26, 20, 35, 13, 26], col); fill(c, [20, 22, 24, 26, 20, 28], 'rgba(255,255,255,.6)');
  },
  band(c, col) {
    c.beginPath(); c.arc(20, 24, 9, 0, Math.PI * 2); c.strokeStyle = '#c9a24a'; c.lineWidth = 4; c.stroke();
    fill(c, [20, 6, 26, 12, 20, 18, 14, 12], col);
  },
  belt(c, col) {
    c.fillStyle = col; c.beginPath(); c.roundRect(5, 15, 30, 10, 3); c.fill();
    c.strokeStyle = '#e3bd55'; c.lineWidth = 2.5; c.strokeRect(16, 13, 9, 14);
  },
  boots(c, col) {
    fill(c, [13, 6, 23, 6, 23, 24, 33, 28, 33, 34, 11, 34], col);
    stroke(c, [11, 34, 33, 34], 'rgba(0,0,0,.45)', 3);
  },
  resource(c, col) {
    fill(c, [20, 6, 31, 14, 29, 28, 20, 34, 11, 28, 9, 14], col);
    fill(c, [20, 6, 31, 14, 20, 18, 9, 14], 'rgba(255,255,255,.35)');
  },
  food(c, col) {
    c.fillStyle = col; c.beginPath(); c.ellipse(20, 23, 14, 10, 0, 0, Math.PI * 2); c.fill();
    stroke(c, [13, 19, 16, 24], 'rgba(255,255,255,.5)', 2); stroke(c, [19, 17, 22, 23], 'rgba(255,255,255,.5)', 2); stroke(c, [25, 19, 28, 24], 'rgba(255,255,255,.5)', 2);
  },
};

export const ITEM_ICON: Record<string, string> = {
  weapon: 'weapon', helm: 'helm', cloak: 'cloak', amulet: 'amulet', ring: 'band', belt: 'belt', boots: 'boots', resource: 'resource', food: 'food',
};

export function icon(kind: string, color: string): string {
  const key = kind + color;
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 40;
  const c = cv.getContext('2d')!;
  const g = c.createLinearGradient(0, 0, 0, 40);
  g.addColorStop(0, '#39424f');
  g.addColorStop(1, '#1f252e');
  c.fillStyle = g;
  c.beginPath(); c.roundRect(0, 0, 40, 40, 7); c.fill();
  (DRAW[kind] ?? DRAW.resource!)(c, color);
  const url = cv.toDataURL();
  cache.set(key, url);
  return url;
}
