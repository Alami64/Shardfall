// Draws the map, scenery, actors, cell highlights and effects on the canvas.
import { MONSTERS } from '../core/content.js';
import { CELLS, center, rowOf, TH, TW, VIEW_H, VIEW_W } from '../core/grid.js';
import { createRng } from '../core/rng.js';
import type { GameMap } from '../core/world.js';
import { G, type Actor } from '../state.js';
import { BACKDROP, diamond, drawDecor, drawHero, drawMonster, drawObject, drawTile } from './sprites.js';

type C = CanvasRenderingContext2D;

let ground: HTMLCanvasElement | null = null;

export function setMap(map: GameMap) {
  ground = document.createElement('canvas');
  ground.width = VIEW_W;
  ground.height = VIEW_H;
  const c = ground.getContext('2d')!;
  const biome = map.def.biome;
  c.fillStyle = BACKDROP[biome];
  c.fillRect(0, 0, VIEW_W, VIEW_H);
  const rnd = createRng(map.def.seed * 31 + 7);
  for (let i = 0; i < CELLS; i++) {
    const { x, y } = center(i);
    drawTile(c, x, y, biome, map.ground[i]!, !!map.road[i], !!map.water[i]);
  }
  for (let i = 0; i < CELLS; i++) {
    const { x, y } = center(i);
    const r1 = rnd;
    if (!map.water[i]) drawDecor(c, x, y, biome, !!map.road[i], r1);
    const dir = map.exits[i];
    if (dir && (i + rowOf(i)) % 2 === 0) {
      const [dx, dy] = dir === 'up' ? [0, -1] : dir === 'down' ? [0, 1] : dir === 'left' ? [-1, 0] : [1, 0];
      c.save();
      c.translate(x, y);
      c.rotate(Math.atan2(dy, dx));
      c.beginPath();
      c.moveTo(-5, -5); c.lineTo(3, 0); c.lineTo(-5, 5);
      c.strokeStyle = 'rgba(255,255,255,.55)';
      c.lineWidth = 2.2;
      c.lineCap = 'round';
      c.stroke();
      c.restore();
    }
  }
  // Soft vignette.
  const g = c.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.45, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,.28)');
  c.fillStyle = g;
  c.fillRect(0, 0, VIEW_W, VIEW_H);
}

// ------------------------------------------------------------ effects

interface Float { x: number; y: number; text: string; color: string; size: number; t0: number }
interface Proj { x0: number; y0: number; x1: number; y1: number; color: string; t0: number; dur: number }
interface Burst { x: number; y: number; color: string; t0: number; dur: number }
const floats: Float[] = [];
const projs: Proj[] = [];
const bursts: Burst[] = [];

export function floatText(x: number, y: number, text: string, color: string, size = 17) {
  // Stack texts that appear at the same spot.
  const same = floats.filter((f) => Math.abs(f.x - x) < 20 && G.now - f.t0 < 500).length;
  floats.push({ x, y: y - same * 16, text, color, size, t0: G.now });
}
export function projectile(x0: number, y0: number, x1: number, y1: number, color: string, dur: number) {
  projs.push({ x0, y0, x1, y1, color, t0: G.now, dur });
}
export function burst(x: number, y: number, color: string, dur = 380) {
  bursts.push({ x, y, color, t0: G.now, dur });
}

// ------------------------------------------------------------ actors

export function placeActor(a: Actor, cell: number) {
  const p = center(cell);
  a.cell = cell;
  a.x = p.x;
  a.y = p.y;
  a.path = [];
  a.walking = false;
}

export function updateActors(dt: number) {
  for (const a of G.actors) {
    if (!a.path.length) { a.walking = false; continue; }
    a.walking = true;
    let left = a.speed * dt;
    while (left > 0 && a.path.length) {
      const p = center(a.path[0]!);
      const dx = p.x - a.x, dy = p.y - a.y;
      const d = Math.hypot(dx, dy);
      if (Math.abs(dx) > 0.5) a.facing = dx > 0 ? 1 : -1;
      if (d <= left) {
        a.x = p.x; a.y = p.y;
        left -= d;
        a.cell = a.path.shift()!;
        a.onStep?.(a.cell);
        if (!a.path.length) {
          a.walking = false;
          const done = a.onArrive;
          a.onArrive = undefined;
          done?.();
        }
      } else {
        a.x += (dx / d) * left;
        a.y += (dy / d) * left;
        left = 0;
      }
    }
  }
}

/** Topmost actor under a screen point. */
export function actorAt(px: number, py: number): Actor | null {
  let best: Actor | null = null;
  for (const a of G.actors) {
    if (a.alpha < 0.5) continue;
    const w = 17 * a.scale, h = 50 * a.scale;
    if (px >= a.x - w && px <= a.x + w && py >= a.y - h && py <= a.y + 8) {
      if (!best || a.y > best.y) best = a;
    }
  }
  return best;
}

function drawActor(c: C, a: Actor, t: number) {
  let x = a.x, y = a.y;
  if (a.lunge) {
    const k = (t - a.lunge.t0) / 240;
    if (k >= 1) a.lunge = undefined;
    else { const s = Math.sin(Math.PI * k) * 12; x += a.lunge.dx * s; y += a.lunge.dy * s; }
  }
  const flash = t < a.flashUntil;
  if (flash) x += Math.sin(t * 0.09) * 2.5;
  const f = G.fight;
  if (f && a.fighterId !== undefined) {
    const active = f.phase !== 'placement' && f.turnId === a.fighterId;
    c.beginPath();
    c.ellipse(a.x, a.y + 1, 19 * Math.min(1.3, a.scale), 8.5 * Math.min(1.3, a.scale), 0, 0, Math.PI * 2);
    c.strokeStyle = a.team === 0 ? 'rgba(255,120,90,.95)' : 'rgba(90,160,255,.95)';
    c.lineWidth = active ? 3 : 1.8;
    c.globalAlpha = a.alpha * (active ? 0.75 + 0.25 * Math.sin(t * 0.008) : 0.8);
    c.stroke();
    c.globalAlpha = 1;
  }
  c.save();
  c.globalAlpha = a.alpha;
  c.translate(x, y);
  if (flash) c.filter = 'brightness(1.9) saturate(1.4)';
  c.scale(a.scale, a.scale);
  if (a.kind === 'monster') {
    c.scale(a.facing, 1);
    drawMonster(c, a.shape!, a.colors!, t + a.cell * 37, a.walking);
  } else {
    drawHero(c, a.look!, t, { facing: a.facing, walking: a.walking, armed: !!a.armed, elder: a.elder });
  }
  c.restore();
  // Labels and bars.
  const top = y - 52 * a.scale;
  c.textAlign = 'center';
  if (a.kind === 'npc') label(c, a.name, x, top - 4, '#ffe9b0');
  if (a.group && G.mode === 'explore') {
    const n = a.group.members.length;
    const lv = a.group.members.reduce((s, m) => s + m.level, 0);
    label(c, a.group.boss ? `★ Lv ${lv}` : `${n > 1 ? n + ' · ' : ''}Lv ${lv}`, x, top - 2, a.group.boss ? '#ffb3a0' : '#fff');
  }
  if (f && a.fighterId !== undefined && a.maxHp && a.alpha > 0.5) {
    const w = 30, frac = Math.max(0, (a.hp ?? 0) / a.maxHp);
    c.fillStyle = 'rgba(20,16,14,.75)';
    c.fillRect(x - w / 2 - 1, top - 5, w + 2, 5);
    c.fillStyle = a.team === 0 ? '#ff6b5a' : '#5aa0ff';
    c.fillRect(x - w / 2, top - 4, w * frac, 3);
  }
}

function label(c: C, text: string, x: number, y: number, color: string) {
  c.font = '600 11px system-ui, sans-serif';
  c.lineWidth = 3;
  c.strokeStyle = 'rgba(20,16,14,.8)';
  c.strokeText(text, x, y);
  c.fillStyle = color;
  c.fillText(text, x, y);
}

// ------------------------------------------------------------ frame

export function render(c: C, t: number) {
  const map = G.map;
  if (!ground || !map) return;
  c.drawImage(ground, 0, 0);
  const inFight = G.mode === 'fight';

  if (inFight) {
    c.strokeStyle = 'rgba(20,30,20,.28)';
    c.lineWidth = 1;
    for (let i = 0; i < CELLS; i++) {
      if (!map.walkable[i]) continue;
      const p = center(i);
      diamond(c, p.x, p.y, 1);
      c.stroke();
    }
  }
  for (const m of G.marks) {
    const p = center(m.cell);
    diamond(c, p.x, p.y, 2);
    c.fillStyle = m.fill;
    c.fill();
    if (m.stroke) { c.strokeStyle = m.stroke; c.lineWidth = 1.5; c.stroke(); }
  }
  if (G.hover >= 0) {
    const p = center(G.hover);
    diamond(c, p.x, p.y, 1);
    c.strokeStyle = map.exits[G.hover] && !inFight ? 'rgba(255,214,120,.95)' : 'rgba(255,255,255,.7)';
    c.lineWidth = 2;
    c.stroke();
  }

  // Scenery and actors, back to front.
  const items: { y: number; x: number; draw: () => void }[] = [];
  for (let i = 0; i < CELLS; i++) {
    const o = map.obj[i];
    if (!o) continue;
    const p = center(i);
    items.push({ y: p.y, x: p.x, draw: () => drawObject(c, p.x, p.y, o, map.def.biome, t) });
  }
  for (const a of G.actors) {
    if (a.alpha <= 0) continue;
    items.push({ y: a.y + 0.5, x: a.x, draw: () => drawActor(c, a, t) });
  }
  items.sort((p, q) => p.y - q.y || p.x - q.x);
  for (const it of items) it.draw();

  // Effects.
  for (let i = projs.length - 1; i >= 0; i--) {
    const p = projs[i]!;
    const k = (t - p.t0) / p.dur;
    if (k >= 1) { projs.splice(i, 1); continue; }
    const x = p.x0 + (p.x1 - p.x0) * k, y = p.y0 + (p.y1 - p.y0) * k - Math.sin(Math.PI * k) * 18;
    c.save();
    c.shadowColor = p.color;
    c.shadowBlur = 14;
    c.fillStyle = p.color;
    c.beginPath(); c.arc(x, y, 5.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(x, y, 2.5, 0, Math.PI * 2); c.fill();
    c.restore();
  }
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i]!;
    const k = (t - b.t0) / b.dur;
    if (k >= 1) { bursts.splice(i, 1); continue; }
    c.save();
    c.globalAlpha = 1 - k;
    c.strokeStyle = b.color;
    c.lineWidth = 4 * (1 - k) + 1;
    c.beginPath();
    c.ellipse(b.x, b.y - 14, 8 + k * 26, (8 + k * 26) * 0.6, 0, 0, Math.PI * 2);
    c.stroke();
    for (let s = 0; s < 6; s++) {
      const ang = (s / 6) * Math.PI * 2 + b.t0;
      c.fillStyle = b.color;
      c.beginPath();
      c.arc(b.x + Math.cos(ang) * k * 30, b.y - 14 + Math.sin(ang) * k * 18 - k * 8, 2.5 * (1 - k) + 0.5, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }
  c.textAlign = 'center';
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i]!;
    const k = (t - f.t0) / 1100;
    if (k >= 1) { floats.splice(i, 1); continue; }
    c.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    c.font = `800 ${f.size}px system-ui, sans-serif`;
    c.lineWidth = 4;
    c.strokeStyle = 'rgba(20,16,14,.9)';
    const y = f.y - 46 - k * 30;
    c.strokeText(f.text, f.x, y);
    c.fillStyle = f.color;
    c.fillText(f.text, f.x, y);
    c.globalAlpha = 1;
  }
}

// ------------------------------------------------------------ portraits

const portraits = new Map<string, string>();

export function portrait(a: { kind: string; shape?: string; colors?: [string, string]; look?: Actor['look']; elder?: boolean }): string {
  const key = a.kind === 'monster' ? a.shape! + a.colors![0] : JSON.stringify(a.look) + (a.elder ? 'e' : '');
  const hit = portraits.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 48;
  const c = cv.getContext('2d')!;
  c.translate(24, 45);
  if (a.kind === 'monster') {
    const s = a.shape === 'treant' ? 0.62 : a.shape === 'golem' || a.shape === 'acolyte' || a.shape === 'briar' ? 0.82 : 1;
    c.scale(s, s);
    drawMonster(c, a.shape!, a.colors!, 0, false);
  } else {
    c.scale(0.92, 0.92);
    drawHero(c, a.look!, 0, { facing: 1, walking: false, armed: a.kind === 'hero', elder: a.elder });
  }
  const url = cv.toDataURL();
  portraits.set(key, url);
  return url;
}

export const monsterPortrait = (defId: string) => {
  const d = MONSTERS[defId]!;
  return portrait({ kind: 'monster', shape: d.shape, colors: d.colors });
};

export { TW, TH };
