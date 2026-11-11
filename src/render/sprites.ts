// All art is drawn in code: tiles, scenery, the hero, NPCs and monsters.
import type { Biome } from '../core/content.js';
import type { HeroLook } from '../core/character.js';
import type { MapObj } from '../core/world.js';
import { TH, TW } from '../core/grid.js';

type C = CanvasRenderingContext2D;
export const OUTLINE = 'rgba(34,24,20,.85)';

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * (amt / 100) : v * (1 + amt / 100))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function ell(c: C, x: number, y: number, rx: number, ry: number, fill: string, stroke: string | null = OUTLINE, lw = 1.4) {
  c.beginPath();
  c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
  c.fillStyle = fill;
  c.fill();
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
}

function poly(c: C, pts: number[], fill: string | null, stroke: string | null = OUTLINE, lw = 1.4) {
  c.beginPath();
  c.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i]!, pts[i + 1]!);
  c.closePath();
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.lineJoin = 'round'; c.stroke(); }
}

function rr(c: C, x: number, y: number, w: number, h: number, r: number, fill: string, stroke: string | null = OUTLINE, lw = 1.4) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.fillStyle = fill;
  c.fill();
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
}

function line(c: C, pts: number[], color: string, lw: number) {
  c.beginPath();
  c.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i]!, pts[i + 1]!);
  c.strokeStyle = color;
  c.lineWidth = lw;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.stroke();
}

function shadow(c: C, x: number, y: number, rx: number, ry: number) {
  ell(c, x, y, rx, ry, 'rgba(0,0,0,.25)', null);
}

// ------------------------------------------------------------ tiles

export const GROUND: Record<Biome, string[]> = {
  village: ['#8bbf5e', '#84b858', '#92c665', '#87bb5a'],
  meadow: ['#93c95f', '#8ac257', '#9bd068', '#8fc55b'],
  forest: ['#5f9a48', '#589242', '#67a34f', '#5c9645'],
  marsh: ['#73936a', '#6b8b62', '#7a9a71', '#6f8f66'],
  ruins: ['#aaa396', '#a29b8e', '#b1aa9d', '#a69f92'],
  hollow: ['#5e4c55', '#57464e', '#65525c', '#5b4952'],
};
export const BACKDROP: Record<Biome, string> = {
  village: '#3d5a34', meadow: '#41632f', forest: '#24402a', marsh: '#2c3f3a', ruins: '#4a4640', hollow: '#261d24',
};
const ROAD = ['#d8c090', '#d0b888', '#dcc698', '#d4bc8c'];

export function diamond(c: C, x: number, y: number, inset = 0) {
  c.beginPath();
  c.moveTo(x, y - TH / 2 + inset / 2);
  c.lineTo(x + TW / 2 - inset, y);
  c.lineTo(x, y + TH / 2 - inset / 2);
  c.lineTo(x - TW / 2 + inset, y);
  c.closePath();
}

export function drawTile(c: C, x: number, y: number, biome: Biome, variant: number, road: boolean, water: boolean) {
  diamond(c, x, y);
  if (water) {
    c.fillStyle = biome === 'hollow' ? '#3a5a6a' : '#4f9dc0';
    c.fill();
    diamond(c, x, y + 1, 6);
    c.fillStyle = biome === 'hollow' ? '#456b7c' : '#63b3d4';
    c.fill();
    line(c, [x - 12, y - 2, x - 2, y - 2], 'rgba(255,255,255,.45)', 1.5);
    line(c, [x + 4, y + 4, x + 12, y + 4], 'rgba(255,255,255,.3)', 1.5);
    return;
  }
  c.fillStyle = road ? ROAD[variant]! : GROUND[biome][variant]!;
  c.fill();
  c.strokeStyle = 'rgba(0,0,0,.06)';
  c.lineWidth = 1;
  c.stroke();
}

/** Small ground details; rnd is a seeded random function. */
export function drawDecor(c: C, x: number, y: number, biome: Biome, road: boolean, rnd: () => number) {
  const r = rnd();
  const ox = (rnd() - 0.5) * 30, oy = (rnd() - 0.5) * 12;
  if (road) {
    if (r < 0.3) ell(c, x + ox, y + oy, 3, 1.6, 'rgba(120,96,60,.35)', null);
    return;
  }
  if (biome === 'meadow' || biome === 'village' || biome === 'forest') {
    if (r < 0.35) {
      const g = biome === 'forest' ? 'rgba(30,70,30,.5)' : 'rgba(50,110,40,.5)';
      line(c, [x + ox - 3, y + oy, x + ox - 4, y + oy - 5], g, 1.3);
      line(c, [x + ox, y + oy, x + ox, y + oy - 6], g, 1.3);
      line(c, [x + ox + 3, y + oy, x + ox + 4, y + oy - 5], g, 1.3);
    } else if (r < 0.47 && biome !== 'forest') {
      const col = ['#fff7d6', '#ffd95e', '#ff9ec4', '#ffffff'][Math.floor(rnd() * 4)]!;
      for (let k = 0; k < 3; k++) ell(c, x + ox + (rnd() - 0.5) * 12, y + oy + (rnd() - 0.5) * 6, 1.8, 1.4, col, null);
    } else if (r < 0.42 && biome === 'forest') {
      ell(c, x + ox, y + oy, 5, 2.4, 'rgba(40,80,35,.45)', null);
    }
  } else if (biome === 'marsh') {
    if (r < 0.3) {
      line(c, [x + ox, y + oy, x + ox - 1, y + oy - 9], 'rgba(60,80,40,.7)', 1.4);
      line(c, [x + ox + 3, y + oy, x + ox + 4, y + oy - 7], 'rgba(60,80,40,.7)', 1.4);
    } else if (r < 0.45) ell(c, x + ox, y + oy, 6, 2.6, 'rgba(40,60,50,.35)', null);
  } else if (biome === 'ruins') {
    if (r < 0.3) line(c, [x + ox - 6, y + oy, x + ox, y + oy - 2, x + ox + 5, y + oy + 2], 'rgba(60,55,50,.4)', 1);
    else if (r < 0.45) ell(c, x + ox, y + oy, 2.5, 1.5, 'rgba(90,85,78,.7)', null);
    else if (r < 0.52) ell(c, x + ox, y + oy, 5, 2.2, 'rgba(110,140,80,.35)', null);
  } else if (biome === 'hollow') {
    if (r < 0.2) ell(c, x + ox, y + oy, 1.6, 1.2, 'rgba(160,255,190,.7)', null);
    else if (r < 0.4) line(c, [x + ox - 7, y + oy, x + ox, y + oy - 2, x + ox + 6, y + oy + 1], 'rgba(30,20,25,.45)', 1.6);
  }
}

// ------------------------------------------------------------ scenery

const LEAF = ['#4f9a3c', '#58a544', '#479036', '#62ad4a'];

function tree(c: C, x: number, y: number, v: number) {
  const s = 1 + (v % 2) * 0.12, leaf = LEAF[v]!;
  shadow(c, x, y + 2, 22, 9);
  poly(c, [x - 5, y + 2, x - 3.5, y - 28 * s, x + 3.5, y - 28 * s, x + 5, y + 2], '#7a5536');
  ell(c, x - 12, y - 36 * s, 15, 14, shade(leaf, -12));
  ell(c, x + 12, y - 38 * s, 15, 14, shade(leaf, -6));
  ell(c, x, y - 52 * s, 18, 17, leaf);
  ell(c, x - 5, y - 58 * s, 8, 6, shade(leaf, 22), null);
  ell(c, x + 12, y - 43 * s, 5, 4, shade(leaf, 16), null);
}

function pine(c: C, x: number, y: number, v: number) {
  const g = ['#2f6b46', '#35744c', '#2a6340', '#3a7c52'][v]!;
  shadow(c, x, y + 2, 16, 7);
  rr(c, x - 3.5, y - 16, 7, 18, 1, '#6a4a30');
  for (let k = 0; k < 3; k++) {
    const w = 20 - k * 4.5, by = y - 12 - k * 16;
    poly(c, [x - w, by, x, by - 26, x + w, by], shade(g, k * 8));
  }
}

function deadtree(c: C, x: number, y: number, v: number) {
  const col = ['#5d5048', '#665a50', '#554a44', '#6a5c52'][v]!;
  shadow(c, x, y + 2, 12, 5);
  poly(c, [x - 5, y + 2, x - 2.5, y - 34, x + 2.5, y - 34, x + 5, y + 2], col);
  line(c, [x, y - 24, x - 12, y - 40, x - 15, y - 50], OUTLINE, 4.6);
  line(c, [x, y - 24, x - 12, y - 40, x - 15, y - 50], col, 3);
  line(c, [x, y - 30, x + 11, y - 44, x + 12, y - 56], OUTLINE, 4.6);
  line(c, [x, y - 30, x + 11, y - 44, x + 12, y - 56], col, 3);
  line(c, [x, y - 34, x + 1, y - 52], OUTLINE, 4);
  line(c, [x, y - 34, x + 1, y - 52], col, 2.4);
}

function bush(c: C, x: number, y: number, v: number, biome: Biome) {
  const g = biome === 'marsh' ? '#6f8a4a' : LEAF[v]!;
  shadow(c, x, y + 2, 16, 6);
  ell(c, x - 9, y - 7, 10, 9, shade(g, -10));
  ell(c, x + 9, y - 7, 10, 9, shade(g, -4));
  ell(c, x, y - 13, 11, 10, g);
  ell(c, x - 3, y - 17, 4, 3, shade(g, 22), null);
  if (v === 1) { ell(c, x + 6, y - 10, 2, 2, '#e8506a', null); ell(c, x - 7, y - 6, 2, 2, '#e8506a', null); }
}

function rock(c: C, x: number, y: number, v: number, biome: Biome) {
  const g = biome === 'hollow' ? '#6a5a66' : biome === 'marsh' ? '#7c8478' : '#9a968e';
  const s = 0.85 + v * 0.1;
  shadow(c, x, y + 2, 18 * s, 7 * s);
  poly(c, [x - 16 * s, y, x - 12 * s, y - 14 * s, x - 2 * s, y - 22 * s, x + 11 * s, y - 17 * s, x + 16 * s, y - 2, x + 6 * s, y + 4, x - 8 * s, y + 4], g);
  poly(c, [x - 12 * s, y - 14 * s, x - 2 * s, y - 22 * s, x + 11 * s, y - 17 * s, x + 2 * s, y - 11 * s], shade(g, 22), null);
  line(c, [x + 2 * s, y - 11 * s, x + 4 * s, y + 2], 'rgba(0,0,0,.2)', 1);
}

function stump(c: C, x: number, y: number) {
  shadow(c, x, y + 2, 14, 6);
  rr(c, x - 10, y - 12, 20, 14, 3, '#7a5536');
  ell(c, x, y - 12, 10, 4.5, '#c9a878');
  ell(c, x, y - 12, 5, 2.2, 'rgba(0,0,0,0)', 'rgba(110,80,50,.7)', 1);
}

function pillar(c: C, x: number, y: number, v: number) {
  const h = [46, 30, 52, 38][v]!;
  shadow(c, x, y + 2, 15, 6);
  rr(c, x - 12, y - 6, 24, 9, 2, '#8e897f');
  rr(c, x - 8, y - h, 16, h - 4, 1, '#bdb7ab');
  line(c, [x - 3, y - h + 3, x - 3, y - 8], 'rgba(0,0,0,.14)', 1.4);
  line(c, [x + 3, y - h + 3, x + 3, y - 8], 'rgba(0,0,0,.14)', 1.4);
  if (v % 2 === 0) rr(c, x - 11, y - h - 6, 22, 7, 2, '#cfc9bd');
  else poly(c, [x - 8, y - h, x - 4, y - h - 6, x + 1, y - h - 2, x + 5, y - h - 7, x + 8, y - h], '#bdb7ab');
}

function rubble(c: C, x: number, y: number, v: number) {
  ell(c, x - 8, y - 2, 7, 4.5, '#a8a297');
  ell(c, x + 6, y, 8, 5, '#9a948a');
  if (v > 1) ell(c, x, y - 6, 6, 4, '#b6b0a4');
}

function root(c: C, x: number, y: number, v: number) {
  shadow(c, x, y + 2, 20, 6);
  const col = ['#4a342c', '#553c32', '#432f28', '#5a4036'][v]!;
  const arcs = [[x - 18, y, x - 8, y - 30 - v * 3, x + 4, y], [x - 4, y + 2, x + 8, y - 22, x + 18, y]];
  for (const a of arcs) {
    for (const [colr, lw] of [[OUTLINE, 9], [col, 6.5]] as [string, number][]) {
      c.beginPath();
      c.moveTo(a[0]!, a[1]!);
      c.quadraticCurveTo(a[2]!, a[3]!, a[4]!, a[5]!);
      c.strokeStyle = colr;
      c.lineWidth = lw;
      c.lineCap = 'round';
      c.stroke();
    }
  }
  poly(c, [x - 9, y - 16, x - 13, y - 22, x - 7, y - 19], '#2c1f1c', null);
}

function shroom(c: C, x: number, y: number, v: number, t: number) {
  const cap = ['#3f8f8a', '#7a4f9a', '#3a7aa0', '#8a4a7a'][v]!;
  shadow(c, x, y + 2, 16, 6);
  poly(c, [x - 5, y + 2, x - 3.5, y - 26, x + 3.5, y - 26, x + 5, y + 2], '#d9d2c4');
  c.beginPath();
  c.ellipse(x, y - 26, 19, 15, 0, Math.PI, Math.PI * 2);
  c.closePath();
  c.fillStyle = cap; c.fill(); c.strokeStyle = OUTLINE; c.lineWidth = 1.4; c.stroke();
  const glow = 0.55 + 0.35 * Math.sin(t * 0.002 + v);
  for (const [dx, dy, r] of [[-9, -31, 3], [2, -36, 3.5], [10, -30, 2.5]] as [number, number, number][]) {
    ell(c, x + dx, y + dy, r, r * 0.8, `rgba(190,255,220,${glow})`, null);
  }
}

function waystone(c: C, x: number, y: number, t: number) {
  shadow(c, x, y + 3, 20, 8);
  rr(c, x - 16, y - 6, 32, 10, 3, '#7d8792');
  poly(c, [x - 10, y - 4, x - 12, y - 46, x - 2, y - 62, x + 9, y - 50, x + 11, y - 4], '#9aa6b4');
  poly(c, [x - 12, y - 46, x - 2, y - 62, x + 9, y - 50, x, y - 44], '#b8c4d0', null);
  const g = 0.6 + 0.4 * Math.sin(t * 0.003);
  c.save();
  c.shadowColor = '#ffb347';
  c.shadowBlur = 10 * g;
  line(c, [x - 4, y - 36, x + 4, y - 30, x - 4, y - 22, x + 4, y - 16], `rgba(255,190,90,${0.6 + 0.4 * g})`, 2.2);
  c.restore();
}

function crate(c: C, x: number, y: number) {
  shadow(c, x, y + 3, 16, 6);
  const h = 16;
  poly(c, [x - 14, y - 3, x, y + 4, x, y + 4 - h, x - 14, y - 3 - h], '#b58c5a');
  poly(c, [x, y + 4, x + 14, y - 3, x + 14, y - 3 - h, x, y + 4 - h], '#96713f');
  poly(c, [x - 14, y - 3 - h, x, y - 10 - h, x + 14, y - 3 - h, x, y + 4 - h], '#cfa670');
  line(c, [x - 14, y - 3 - h, x, y + 4, x - 7, y, x - 7, y - h], 'rgba(60,40,20,.35)', 1);
}

function barrel(c: C, x: number, y: number) {
  shadow(c, x, y + 3, 12, 5);
  rr(c, x - 9, y - 20, 18, 22, 4, '#8f6a42');
  line(c, [x - 9, y - 13, x + 9, y - 13], '#5a4a3a', 2);
  line(c, [x - 9, y - 4, x + 9, y - 4], '#5a4a3a', 2);
  ell(c, x, y - 20, 9, 3.5, '#b08a5c');
}

function lamp(c: C, x: number, y: number, t: number) {
  shadow(c, x, y + 2, 7, 3);
  rr(c, x - 1.8, y - 44, 3.6, 46, 1, '#3d3a3a');
  const g = 0.75 + 0.25 * Math.sin(t * 0.004 + x);
  c.save();
  c.shadowColor = '#ffcf70';
  c.shadowBlur = 16 * g;
  rr(c, x - 5, y - 56, 10, 12, 2, `rgba(255,214,120,${0.75 + 0.25 * g})`);
  c.restore();
  poly(c, [x - 7, y - 56, x, y - 62, x + 7, y - 56], '#3d3a3a');
}

function well(c: C, x: number, y: number) {
  shadow(c, x, y + 3, 20, 8);
  rr(c, x - 15, y - 14, 30, 16, 5, '#9a968e');
  ell(c, x, y - 14, 15, 6, '#b8b4ac');
  ell(c, x, y - 14, 10, 3.6, '#2c4a5c', null);
  rr(c, x - 15, y - 44, 3, 32, 1, '#6a4a30');
  rr(c, x + 12, y - 44, 3, 32, 1, '#6a4a30');
  poly(c, [x - 20, y - 42, x, y - 56, x + 20, y - 42], '#9c4f3c');
}

function block(c: C, x: number, y: number, o: MapObj) {
  const [hN, hE, hS, hW] = o.h!;
  const wall = o.wall ?? '#b9b3a8', roof = o.roof ?? '#b3aea4';
  const N = [x, y - TH / 2], E = [x + TW / 2, y], S = [x, y + TH / 2], W = [x - TW / 2, y];
  // Front walls.
  poly(c, [W[0]!, W[1]!, S[0]!, S[1]!, S[0]!, S[1]! - hS, W[0]!, W[1]! - hW], shade(wall, -4));
  poly(c, [S[0]!, S[1]!, E[0]!, E[1]!, E[0]!, E[1]! - hE, S[0]!, S[1]! - hS], shade(wall, -22));
  const low = Math.min(hS, hW, hE);
  if (o.roof && low > 30) {
    if (o.door === 'L') {
      poly(c, [x - 22, y + 5, x - 10, y + 11, x - 10, y - 13, x - 22, y - 19], '#6a4428');
      ell(c, x - 13, y - 2, 1.2, 1.2, '#e8c860', null);
    } else if (o.door === 'R') {
      poly(c, [x + 10, y + 11, x + 22, y + 5, x + 22, y - 19, x + 10, y - 13], '#553620');
      ell(c, x + 13, y - 2, 1.2, 1.2, '#e8c860', null);
    } else if (o.window) {
      if (hS <= hW) poly(c, [x - 21, y - 12, x - 11, y - 7, x - 11, y - 19, x - 21, y - 24], '#ffe9a8', 'rgba(60,40,30,.8)', 1.2);
      if (hS <= hE) poly(c, [x + 11, y - 7, x + 21, y - 12, x + 21, y - 24, x + 11, y - 19], '#e6cf8a', 'rgba(60,40,30,.8)', 1.2);
    }
  } else if (!o.roof || low <= 30) {
    line(c, [W[0]! + 6, W[1]! - hW * 0.45 + 3, S[0]! - 4, S[1]! - hS * 0.45 - 2], 'rgba(0,0,0,.14)', 1);
    line(c, [S[0]! + 4, S[1]! - hS * 0.6 - 2, E[0]! - 6, E[1]! - hE * 0.6 + 3], 'rgba(0,0,0,.14)', 1);
  }
  // Top.
  const lit = hS + hW > hN + hE ? -14 : hS + hW < hN + hE ? 6 : 0;
  poly(c, [N[0]!, N[1]! - hN, E[0]!, E[1]! - hE, S[0]!, S[1]! - hS, W[0]!, W[1]! - hW], shade(roof, lit));
  if (o.roof && low > 30) {
    for (const f of [0.33, 0.66]) {
      const ax = N[0]! + (W[0]! - N[0]!) * f, ay = N[1]! - hN + (W[1]! - hW - (N[1]! - hN)) * f;
      const bx = E[0]! + (S[0]! - E[0]!) * f, by = E[1]! - hE + (S[1]! - hS - (E[1]! - hE)) * f;
      line(c, [ax, ay, bx, by], 'rgba(0,0,0,.13)', 1);
    }
  }
}

export function drawObject(c: C, x: number, y: number, o: MapObj, biome: Biome, t: number) {
  switch (o.kind) {
    case 'tree': tree(c, x, y, o.variant); break;
    case 'pine': pine(c, x, y, o.variant); break;
    case 'deadtree': deadtree(c, x, y, o.variant); break;
    case 'bush': bush(c, x, y, o.variant, biome); break;
    case 'rock': rock(c, x, y, o.variant, biome); break;
    case 'stump': stump(c, x, y); break;
    case 'pillar': pillar(c, x, y, o.variant); break;
    case 'rubble': rubble(c, x, y, o.variant); break;
    case 'root': root(c, x, y, o.variant); break;
    case 'shroom': shroom(c, x, y, o.variant, t); break;
    case 'stone': waystone(c, x, y, t); break;
    case 'crate': crate(c, x, y); break;
    case 'barrel': barrel(c, x, y); break;
    case 'lamp': lamp(c, x, y, t); break;
    case 'well': well(c, x, y); break;
    case 'block': block(c, x, y, o); break;
  }
}

// ------------------------------------------------------------ hero and NPCs

/** Every timing (ms), angle (radians) and distance (px) of the hero's motion, in one place. */
export const HERO_MOTION = {
  breath: { period: 2600, amp: 0.7 },
  cloak: { period: 3100, amp: 1.3 },
  blink: { every: 3600, dur: 130 },
  walk: { stride: 400, leg: 0.62, arm: 0.5, swordArm: 0.3, bob: 2.2, lean: 0.07 },
  /** Blade angle measured from the line of the arm: at rest it points up, armed it continues the arm. */
  sword: { rest: 2.72, armed: 0.2 },
  attack: { dur: 430, windup: 0.3, strike: 0.6, raise: 3.5, end: 0.7, lean: 0.17 },
  cast: { dur: 500, raise: 0.45, hold: 0.7, up: 2.75, thrust: 1.6, hop: 3 },
  hit: { dur: 300, lean: 0.24, squash: 0.08 },
  die: { dur: 420, fall: 1.35 },
  cheer: { dur: 900, jump: 9, arm: 2.95 },
  /** Follow-through of the head and the sprout (sprite hero), and how its short legs move. */
  head: { lag: 90, follow: 0.7, tilt: 0.04 },
  sprout: { period: 2300, sway: 0.14, walk: 0.3, lag: 170 },
  sprite: { leg: 0.55, lift: 3 },
};
export type AnimKind = 'attack' | 'cast' | 'hit' | 'die' | 'cheer';
export const animDur = (kind: AnimKind) => HERO_MOTION[kind].dur;

export interface HeroState { walking: boolean; anim?: { kind: AnimKind; k: number; color?: string } }
/** Joint angles are radians, positive towards the front of the figure. */
export interface HeroPose {
  bob: number; lean: number; squash: number; legA: number; legB: number; armF: number; armB: number;
  blade: number; cloak: number; blink: boolean; glow: number; glowColor: string; trail: number; fall: number;
  /** Extra head offset (px) and tilt, and sprout tilt: parts that follow the body a beat late. */
  headDy: number; headRot: number; sprout: number;
}
export interface HeroLookAt { facing: number; back: boolean; armed: boolean; elder?: boolean }

const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = (k: number) => k * k * (3 - 2 * k);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const seg = (k: number, a: number, b: number) => Math.max(0, Math.min(1, (k - a) / (b - a)));

/** The pose for a moment in time. With t = 0 and no action this is the rest pose. */
export function heroPose(s: HeroState, t: number, seed = 0): HeroPose {
  const M = HERO_MOTION;
  const p: HeroPose = {
    bob: 0, lean: 0, squash: 1, legA: 0, legB: 0, armF: 0, armB: 0,
    blade: M.sword.rest, cloak: 0, blink: false, glow: 0, glowColor: '#ffd166', trail: -1, fall: 0,
    headDy: 0, headRot: 0, sprout: 0,
  };
  const live = REDUCED ? 0 : 1;
  if (s.walking) {
    const ph = (t / M.walk.stride) * Math.PI * 2;
    const sw = Math.sin(ph);
    p.legA = sw * M.walk.leg;
    p.legB = -sw * M.walk.leg;
    p.armB = sw * M.walk.arm;
    p.armF = -sw * M.walk.swordArm;
    p.bob = Math.abs(Math.cos(ph)) * M.walk.bob;
    p.lean = M.walk.lean;
    p.cloak = -2.5 - sw;
    const late = ph - (M.head.lag / M.walk.stride) * Math.PI * 2;
    p.headDy = (p.bob - Math.abs(Math.cos(late)) * M.walk.bob) * M.head.follow;
    p.headRot = Math.sin(late) * M.head.tilt;
    p.sprout = -Math.sin(ph - (M.sprout.lag / M.walk.stride) * Math.PI * 2) * M.sprout.walk;
  } else {
    p.bob = Math.sin(((t + seed) / M.breath.period) * Math.PI * 2) * M.breath.amp * live;
    p.cloak = Math.sin(((t + seed) / M.cloak.period) * Math.PI * 2) * M.cloak.amp * live;
    p.blink = live === 1 && t > 0 && (t + seed * 7) % M.blink.every < M.blink.dur;
    const lateBob = Math.sin(((t + seed - M.head.lag * 3) / M.breath.period) * Math.PI * 2) * M.breath.amp * live;
    p.headDy = (p.bob - lateBob) * M.head.follow;
    p.sprout = Math.sin(((t + seed) / M.sprout.period) * Math.PI * 2) * M.sprout.sway * live;
  }
  const a = s.anim;
  if (!a) return p;
  const k = Math.max(0, Math.min(1, a.k));
  switch (a.kind) {
    case 'attack': {
      const A = M.attack;
      if (k < A.windup) {
        const e = ease(k / A.windup);
        p.armF = lerp(p.armF, A.raise, e);
        p.blade = lerp(M.sword.rest, M.sword.armed + 0.2, e);
        p.lean = -A.lean * 0.6 * e;
      } else if (k < A.strike) {
        const e = ease(seg(k, A.windup, A.strike));
        p.armF = lerp(A.raise, A.end, e);
        p.blade = M.sword.armed;
        p.lean = lerp(-A.lean * 0.6, A.lean, e);
        p.headRot = 0.08 * e;
        p.sprout = -0.5 * e;
        p.trail = e;
        p.legA = 0.35 * e;
        p.legB = -0.3 * e;
      } else {
        const e = ease(seg(k, A.strike, 1));
        p.armF = lerp(A.end, 0, e);
        p.blade = lerp(M.sword.armed, M.sword.rest, e);
        p.lean = A.lean * (1 - e);
        p.legA = 0.35 * (1 - e);
        p.legB = -0.3 * (1 - e);
        if (e < 0.5) p.trail = 1 + e;
      }
      break;
    }
    case 'cast': {
      const K = M.cast;
      p.glowColor = a.color ?? p.glowColor;
      if (k < K.raise) {
        const e = ease(k / K.raise);
        p.armF = lerp(p.armF, K.up, e);
        p.blade = lerp(M.sword.rest, M.sword.armed, e);
        p.glow = e;
        p.bob += K.hop * e;
      } else if (k < K.hold) {
        const e = ease(seg(k, K.raise, K.hold));
        p.armF = lerp(K.up, K.thrust, e);
        p.blade = M.sword.armed;
        p.glow = 1;
        p.bob += K.hop * (1 - e);
        p.lean = 0.1 * e;
      } else {
        const e = ease(seg(k, K.hold, 1));
        p.armF = lerp(K.thrust, 0, e);
        p.blade = lerp(M.sword.armed, M.sword.rest, e);
        p.glow = 1 - e;
        p.lean = 0.1 * (1 - e);
      }
      break;
    }
    case 'hit': {
      const env = Math.sin(Math.PI * k);
      p.lean = -M.hit.lean * env;
      p.squash = 1 - M.hit.squash * env;
      p.armB = -0.7 * env;
      p.armF = -0.3 * env;
      p.headRot = -0.12 * env;
      p.headDy = -1.2 * env;
      p.sprout = 0.6 * env;
      break;
    }
    case 'die': {
      const e = ease(k);
      p.fall = e;
      p.armF = 1.2 * e;
      p.armB = -0.8 * e;
      p.legA = 0.3 * e;
      break;
    }
    case 'cheer': {
      const hop = Math.abs(Math.sin(k * Math.PI * 2));
      const r = Math.min(1, k * 6, (1 - k) * 6);
      p.bob = M.cheer.jump * hop;
      p.armF = M.cheer.arm * r;
      p.blade = lerp(M.sword.rest, M.sword.armed, r);
      p.armB = 2.6 * r;
      p.legA = 0.25 * hop;
      p.legB = -0.25 * hop;
      p.sprout = Math.sin(k * Math.PI * 6) * 0.45 * r;
      p.headDy = -hop * 1.2;
      break;
    }
  }
  return p;
}

/** A person drawn from jointed parts, feet at (0, 0). Front or back view, mirrored by facing. */
export function drawHero(c: C, look: HeroLook, p: HeroPose, o: HeroLookAt) {
  shadow(c, 0, 1, 13 - p.bob * 0.3, 5.5 - p.bob * 0.12);
  c.save();
  c.scale(o.facing, 1);
  if (p.fall) { c.rotate(-p.fall * HERO_MOTION.die.fall); c.translate(0, -p.fall * 3); }
  c.rotate(p.lean);
  c.scale(1 + (1 - p.squash) * 0.6, p.squash);
  c.translate(0, -p.bob);
  const dark = shade(look.tunic, -38), sleeve = shade(look.tunic, -16);

  const leg = (hx: number, ang: number, col: string) => {
    c.save();
    c.translate(hx, -13);
    c.rotate(-ang);
    rr(c, -2.75, 0, 5.5, 13, 2, col);
    rr(c, -3.2, 8.8, 7.6, 4.6, 1.8, '#5b4326', OUTLINE, 1);
    c.restore();
  };
  const arm = (sx: number, ang: number, col: string, sword: boolean) => {
    c.save();
    c.translate(sx, -29);
    c.rotate(-ang);
    if (sword) {
      c.save();
      c.translate(0, 14);
      c.rotate(-p.blade);
      line(c, [0, -3, 0, 25], OUTLINE, 5);
      line(c, [0, -3, 0, 25], '#e3e9f0', 3);
      line(c, [0, 9, 0, 16], 'rgba(120,220,255,.9)', 1.4);
      if (p.glow > 0) {
        c.save();
        c.globalAlpha *= p.glow;
        c.shadowColor = p.glowColor;
        c.shadowBlur = 14;
        line(c, [0, 3, 0, 25], p.glowColor, 3);
        ell(c, 0, 26, 2 + 3 * p.glow, 2 + 3 * p.glow, '#fff', null);
        c.restore();
      }
      line(c, [-4, 1, 4, 1], '#c9a24a', 3);
      c.restore();
    }
    rr(c, -2.75, 0, 5.5, 14, 2.5, col);
    ell(c, 0, 14.5, 2.6, 2.6, look.skin, OUTLINE, 1);
    c.restore();
  };
  const trail = () => {
    if (p.trail < 0) return;
    const A = HERO_MOTION.attack;
    const cur = lerp(A.raise, A.end, Math.min(1, p.trail));
    const alpha = p.trail <= 1 ? 0.85 : 0.85 * (1 - (p.trail - 1) * 2);
    c.save();
    c.lineCap = 'round';
    c.beginPath();
    c.arc(6.5, -29, 35, Math.PI / 2 - A.raise, Math.PI / 2 - cur);
    c.strokeStyle = `rgba(190,235,255,${alpha * 0.55})`;
    c.lineWidth = 7;
    c.stroke();
    c.beginPath();
    c.arc(6.5, -29, 36, Math.PI / 2 - lerp(A.raise, cur, 0.4), Math.PI / 2 - cur);
    c.strokeStyle = `rgba(255,255,255,${alpha})`;
    c.lineWidth = 2.4;
    c.stroke();
    c.restore();
  };

  if (!o.back) {
    poly(c, [-7, -31, -13 + p.cloak, -8, -2 + p.cloak * 0.5, -9, 4, -30], dark);
    arm(-6, p.armB, shade(look.tunic, -30), false);
    leg(-3.2, p.legB, '#33292a');
    leg(3.2, p.legA, '#3b2f2a');
    rr(c, -8, -32, 16, 21, 5, look.tunic);
    rr(c, -8, -18, 16, 3.2, 1, '#5b4326', null);
    rr(c, -1.5, -18.6, 3.5, 4.4, 1, '#e3bd55', null);
    line(c, [-3, -30, 3, -22], 'rgba(255,255,255,.25)', 1.6);
    arm(6.5, p.armF, sleeve, o.armed);
    trail();
    ell(c, 0, -39.5, 8, 8.4, look.skin);
    c.beginPath();
    c.arc(0, -41, 8.7, Math.PI * 0.92, Math.PI * 2.12);
    c.quadraticCurveTo(2, -42, -3, -38);
    c.quadraticCurveTo(-7, -34, -9.5, -32);
    c.closePath();
    c.fillStyle = look.hair; c.fill(); c.strokeStyle = OUTLINE; c.lineWidth = 1.2; c.stroke();
    if (p.blink) line(c, [3, -38.4, 5.4, -38.4], '#2a2020', 1.3);
    else rr(c, 3.2, -40, 1.9, 3.2, 0.9, '#2a2020', null);
    if (o.elder) poly(c, [0, -34, 7, -34, 4, -26], look.hair, OUTLINE, 1);
  } else {
    arm(-6, p.armB, shade(look.tunic, -30), false);
    leg(-3.2, p.legB, '#33292a');
    leg(3.2, p.legA, '#3b2f2a');
    rr(c, -8, -32, 16, 21, 5, shade(look.tunic, -10));
    poly(c, [-8.5, -31, -11 + p.cloak, -7, -3 + p.cloak * 0.7, -5, 5 + p.cloak * 0.5, -7, 8.5, -31], dark);
    line(c, [-1, -29, -2 + p.cloak * 0.6, -8], 'rgba(0,0,0,.22)', 1.2);
    line(c, [-8, -30.5, 8, -30.5], shade(look.tunic, 12), 2);
    arm(6.5, p.armF, sleeve, o.armed);
    trail();
    ell(c, 0, -39.5, 8.6, 8.9, look.hair);
    poly(c, [-5, -33, 0, -29.5, 5, -33], look.hair, OUTLINE, 1);
    line(c, [-3, -44, -1, -38], 'rgba(255,255,255,.18)', 1.4);
  }
  c.restore();
}

// ------------------------------------------------------------ monsters

function eyes(c: C, x: number, y: number, gap: number, r: number, pupil = '#1c1418', white = '#fff') {
  ell(c, x - gap, y, r, r * 1.15, white, OUTLINE, 1);
  ell(c, x + gap, y, r, r * 1.15, white, OUTLINE, 1);
  ell(c, x - gap + r * 0.3, y + r * 0.1, r * 0.45, r * 0.55, pupil, null);
  ell(c, x + gap + r * 0.3, y + r * 0.1, r * 0.45, r * 0.55, pupil, null);
}

type Draw = (c: C, a: string, b: string, t: number, moving: boolean) => void;

const SHAPES: Record<string, Draw> = {
  blob(c, a, b, t) {
    const sq = Math.sin(t * 0.004) * 1.2;
    shadow(c, 0, 1, 16, 6);
    c.beginPath();
    c.moveTo(-16 - sq, 0);
    c.bezierCurveTo(-18 - sq, -16 + sq, -8, -25 + sq, 0, -25 + sq);
    c.bezierCurveTo(8, -25 + sq, 18 + sq, -16 + sq, 16 + sq, 0);
    c.bezierCurveTo(8, 4, -8, 4, -16 - sq, 0);
    c.fillStyle = a; c.fill(); c.strokeStyle = OUTLINE; c.lineWidth = 1.4; c.stroke();
    ell(c, -8, -18 + sq, 5, 3, shade(a, 22), null);
    ell(c, 9, -6, 4, 2.5, b, null);
    ell(c, -11, -5, 3, 2, b, null);
    poly(c, [0, -24 + sq, -7, -34 + sq, -1, -30 + sq], '#8fd14f');
    poly(c, [0, -24 + sq, 8, -33 + sq, 2, -29 + sq], '#7cc043');
    eyes(c, 3, -13 + sq, 5, 3.4);
    line(c, [0, -6, 4, -5, 8, -6], OUTLINE, 1.3);
  },
  thistle(c, a, b, t) {
    const hov = Math.sin(t * 0.005) * 2.5;
    shadow(c, 0, 1, 9 - hov * 0.4, 3.6);
    const y = -24 + hov;
    for (let k = 0; k < 9; k++) {
      const ang = (k / 9) * Math.PI * 2 + 0.2;
      const cx = Math.cos(ang), sy = Math.sin(ang);
      poly(c, [cx * 8 - sy * 3, y + sy * 8 + cx * 3, cx * 16, y + sy * 16, cx * 8 + sy * 3, y + sy * 8 - cx * 3], b);
    }
    ell(c, 0, y, 10.5, 10.5, a);
    ell(c, -3, y - 4, 4, 3, shade(a, 25), null);
    line(c, [-4, y + 10, -5, y + 16], OUTLINE, 2);
    line(c, [4, y + 10, 5, y + 16], OUTLINE, 2);
    eyes(c, 2, y - 1, 4, 2.8, '#1c1418', '#fff6b0');
    line(c, [-1, y + 5, 3, y + 6.5, 6, y + 4], OUTLINE, 1.2);
  },
  boar(c, a, b, t, moving) {
    const sw = moving ? Math.sin(t * 0.02) * 2 : 0;
    shadow(c, 0, 1, 20, 6.5);
    for (const [lx, d] of [[-11, 1], [-5, -1], [5, 1], [11, -1]] as [number, number][]) rr(c, lx - 2.5 + sw * d, -9, 5, 10, 2, b);
    ell(c, -1, -15, 18, 11.5, a);
    for (const dx of [-11, -4, 3]) poly(c, [dx - 4, -23, dx, -30, dx + 4, -24], b);
    ell(c, 14, -13, 9, 8.5, shade(a, 8));
    ell(c, 21.5, -10.5, 4.2, 3.6, shade(a, 30));
    poly(c, [10, -20, 12, -27, 16, -21], b);
    poly(c, [16, -7, 21, -15, 20, -6], '#f4eedd');
    ell(c, 16.5, -15, 1.8, 2, '#1c1418', null);
    line(c, [-18, -17, -22, -22], OUTLINE, 2);
  },
  shroom(c, a, b, t) {
    const sq = Math.sin(t * 0.0035) * 1;
    shadow(c, 0, 1, 14, 5.5);
    rr(c, -8, -3, 6, 5, 2, shade(b, -20));
    rr(c, 2, -3, 6, 5, 2, shade(b, -20));
    rr(c, -7, -20, 14, 19, 5, b);
    c.beginPath();
    c.ellipse(0, -19 + sq, 18, 14, 0, Math.PI, Math.PI * 2);
    c.quadraticCurveTo(0, -13 + sq, -18, -19 + sq);
    c.fillStyle = a; c.fill(); c.strokeStyle = OUTLINE; c.lineWidth = 1.4; c.stroke();
    for (const [dx, dy, r] of [[-9, -25, 3], [1, -29, 3.4], [10, -24, 2.6]] as [number, number, number][]) ell(c, dx, dy + sq, r, r * 0.8, shade(a, 45), null);
    eyes(c, 2, -12, 3.6, 2.4, '#1c1418', '#d8ffb0');
    line(c, [-1, -6, 2, -5, 5, -6], OUTLINE, 1.2);
  },
  lurker(c, a, b, t) {
    const br = Math.sin(t * 0.003) * 0.8;
    shadow(c, 0, 1, 22, 6.5);
    for (const dx of [-12, -5, 2]) poly(c, [dx - 4, -15, dx, -24 - br, dx + 4, -15], b);
    ell(c, -2, -9, 20, 10 + br, a);
    ell(c, -6, -13, 8, 3.5, shade(a, 18), null);
    poly(c, [4, -8, 23, -9, 21, -2, 6, 0], shade(a, -10));
    for (const dx of [9, 13, 17]) poly(c, [dx, -3.5, dx + 1.5, 0.5, dx + 3, -3.8], '#f4eedd', null);
    ell(c, 9, -17, 3.4, 3.8, '#ffe066', OUTLINE, 1);
    ell(c, 16, -16, 3.2, 3.6, '#ffe066', OUTLINE, 1);
    ell(c, 9.6, -17, 1, 2.4, '#1c1418', null);
    ell(c, 16.6, -16, 1, 2.3, '#1c1418', null);
    poly(c, [-14, -2, -20, 3, -12, 2], b);
    poly(c, [-2, 0, -4, 5, 3, 2], b);
  },
  wisp(c, a, b, t) {
    const hov = Math.sin(t * 0.004) * 3, y = -26 + hov;
    shadow(c, 0, 1, 8, 3);
    c.save();
    c.shadowColor = a;
    c.shadowBlur = 16;
    c.beginPath();
    c.moveTo(-10, y);
    c.bezierCurveTo(-10, y - 12, -3, y - 14, 2 + Math.sin(t * 0.008) * 3, y - 26);
    c.bezierCurveTo(4, y - 14, 10, y - 10, 10, y);
    c.bezierCurveTo(10, y + 13, -10, y + 13, -10, y);
    c.fillStyle = b; c.fill();
    c.restore();
    ell(c, 0, y + 1, 7.5, 7.5, a, null);
    ell(c, -2, y - 2, 3, 2.4, '#fff', null);
    ell(c, -2.5, y + 2, 1.6, 2.2, '#1b3550', null);
    ell(c, 3.5, y + 2, 1.6, 2.2, '#1b3550', null);
    for (let k = 0; k < 2; k++) {
      const ang = t * 0.004 + k * Math.PI;
      ell(c, Math.cos(ang) * 15, y + Math.sin(ang) * 5, 2, 2, '#fff', null);
    }
  },
  golem(c, a, b, t, moving) {
    const sw = moving ? Math.sin(t * 0.014) * 2 : 0;
    shadow(c, 0, 1, 19, 7);
    rr(c, -11 + sw, -12, 9, 13, 2, b);
    rr(c, 2 - sw, -12, 9, 13, 2, b);
    rr(c, -20, -34, 9, 22, 3, shade(a, -18));
    rr(c, -14, -37, 28, 27, 5, a);
    rr(c, 11, -34, 9, 24, 3, shade(a, -8));
    poly(c, [-9, -30, 0, -34, 4, -24, -6, -20], shade(a, 22), null);
    for (const [dx, dy] of [[-10, -14], [9, -14], [9, -32], [-10, -32]] as [number, number][]) ell(c, dx, dy, 1.3, 1.3, '#3a2c28', null);
    rr(c, -7, -47, 14, 12, 3, shade(a, 10));
    c.save();
    c.shadowColor = '#ffb347'; c.shadowBlur = 8;
    rr(c, -4, -43, 9, 3, 1, '#ffc35a', null);
    c.restore();
    line(c, [-12, -18, -3, -15], 'rgba(60,160,140,.6)', 2);
  },
  acolyte(c, a, b, t) {
    const sway = Math.sin(t * 0.003) * 1;
    shadow(c, 0, 1, 14, 5.5);
    line(c, [12, 0, 13, -44], OUTLINE, 3.6);
    line(c, [12, 0, 13, -44], '#6a5a4a', 2);
    c.save();
    c.shadowColor = b; c.shadowBlur = 12;
    ell(c, 13, -47, 4.5, 4.5, b, null);
    c.restore();
    poly(c, [-7, -32, -13 + sway, 0, 12 + sway, 0, 7, -32], a);
    poly(c, [-2, -30, -4, 0, 3, 0, 2, -30], shade(a, -25), null);
    rr(c, 5, -30, 6, 14, 3, shade(a, 14));
    c.beginPath();
    c.moveTo(-9, -32);
    c.quadraticCurveTo(-10, -50, 0, -50);
    c.quadraticCurveTo(10, -50, 9, -32);
    c.closePath();
    c.fillStyle = shade(a, 10); c.fill(); c.strokeStyle = OUTLINE; c.lineWidth = 1.4; c.stroke();
    ell(c, 1.5, -38, 5.5, 6, '#16121c', null);
    ell(c, 0, -39, 1.4, 1.6, b, null);
    ell(c, 4.5, -39, 1.4, 1.6, b, null);
  },
  briar(c, a, b, t, moving) {
    const sw = moving ? Math.sin(t * 0.016) * 2 : Math.sin(t * 0.003);
    shadow(c, 0, 1, 14, 5.5);
    const vine = (pts: number[], lw: number) => { line(c, pts, OUTLINE, lw + 2); line(c, pts, a, lw); };
    vine([-5 + sw, 0, -4, -14, 0, -22], 5);
    vine([5 - sw, 0, 4, -14, 0, -22], 5);
    vine([0, -18, -2, -30, 1, -36], 8);
    vine([0, -30, -11, -24, -15, -14 + sw], 4);
    vine([0, -30, 11, -27, 17, -36 - sw, 22, -30], 3.5);
    for (const [dx, dy] of [[-6, -9], [6, -12], [-3, -27], [10, -28]] as [number, number][]) poly(c, [dx - 2, dy, dx, dy - 5, dx + 2, dy], shade(a, -30), null);
    for (let k = 0; k < 5; k++) {
      const ang = (k / 5) * Math.PI * 2 + t * 0.0005;
      ell(c, 1 + Math.cos(ang) * 6, -41 + Math.sin(ang) * 5, 4.6, 3.6, b);
    }
    ell(c, 1, -41, 4.6, 4.6, shade(b, -35));
    ell(c, -0.5, -41.5, 1.2, 1.5, '#ffe066', null);
    ell(c, 3, -41.5, 1.2, 1.5, '#ffe066', null);
  },
  treant(c, a, b, t) {
    const br = Math.sin(t * 0.002) * 1;
    shadow(c, 0, 2, 24, 8);
    for (const [x1, x2] of [[-10, -24], [-4, -12], [6, 14], [11, 25]] as [number, number][]) {
      line(c, [x1, -8, x2, 1], OUTLINE, 8);
      line(c, [x1, -8, x2, 1], shade(a, -15), 5.5);
    }
    poly(c, [-13, 0, -11, -30, -15, -46 - br, 15, -46 - br, 11, -30, 13, 0], a);
    line(c, [-6, -8, -5, -22], 'rgba(0,0,0,.22)', 1.6);
    line(c, [6, -6, 5, -18], 'rgba(0,0,0,.22)', 1.6);
    // Arms.
    line(c, [-12, -34, -24, -26, -27, -12], OUTLINE, 8);
    line(c, [-12, -34, -24, -26, -27, -12], shade(a, -10), 5.5);
    line(c, [12, -34, 24, -30, 29, -18], OUTLINE, 8);
    line(c, [12, -34, 24, -30, 29, -18], shade(a, -10), 5.5);
    // Crown of thorns.
    for (const [dx, h] of [[-13, 12], [-7, 20], [0, 16], [7, 22], [13, 13]] as [number, number][]) {
      poly(c, [dx - 3, -45 - br, dx + (dx < 0 ? -3 : 3), -45 - h - br, dx + 3, -45 - br], shade(a, -25));
    }
    for (const [dx, dy] of [[-16, -55], [-8, -64], [8, -66], [17, -56], [0, -60]] as [number, number][]) ell(c, dx, dy - br, 4.5, 3.4, b);
    // Face.
    c.save();
    c.shadowColor = b; c.shadowBlur = 10;
    poly(c, [-9, -38, -3, -36, -8, -32], b, null);
    poly(c, [9, -38, 3, -36, 8, -32], b, null);
    c.restore();
    poly(c, [-8, -27, -5, -22, -2, -26, 1, -21, 4, -26, 7, -22, 9, -27, 6, -17, -6, -17], '#1a1210');
  },
};

export function drawMonster(c: C, shape: string, colors: [string, string], t: number, moving: boolean) {
  (SHAPES[shape] ?? SHAPES.blob!)(c, colors[0], colors[1], t, moving);
}
