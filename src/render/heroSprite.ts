// The hero drawn from the sprite sheet in assets/hero (the player's own design, four views).
// Each view is cut into overlapping pieces (sprout, head, body, two legs) that move a little
// against each other; the pose comes from heroPose, so all timing stays in HERO_MOTION.
import sheetUrl from '../../assets/hero/hero.png';
import { HERO_CELL_H, HERO_CELL_W, HERO_FEET_Y, HERO_FIG_H, HERO_FRAMES } from './heroFrames.js';
import { HERO_MOTION, type HeroLookAt, type HeroPose } from './sprites.js';

type C = CanvasRenderingContext2D;

/** Height of the hero on screen, in canvas pixels. */
export const SPRITE_H = 60;
const K = SPRITE_H / HERO_FIG_H;
const OVERLAP = 5;
/** Where the hand is, in screen pixels from the feet, for a figure facing right. */
const HAND = { x: 17, y: -21 };
const BLADE = 27;

let img: HTMLImageElement | null = null;

export function loadHeroSprite(): Promise<void> {
  return new Promise((done) => {
    const i = new Image();
    i.onload = () => { img = i; done(); };
    i.onerror = () => done();
    i.src = sheetUrl;
  });
}
export const heroSpriteReady = () => !!img;

export function drawSpriteHero(c: C, p: HeroPose, o: HeroLookAt) {
  if (!img) return;
  const M = HERO_MOTION;
  const s = o.facing >= 0 ? 1 : -1;
  const view = (o.back ? 2 : 0) + (s > 0 ? 0 : 1);
  const f = HERO_FRAMES[view]!;
  const sx = view * HERO_CELL_W;

  c.beginPath();
  c.ellipse(0, 1, 16 - p.bob * 0.35, 6.5 - p.bob * 0.14, 0, 0, Math.PI * 2);
  c.fillStyle = 'rgba(0,0,0,.25)';
  c.fill();

  c.save();
  if (p.fall) { c.rotate(-s * p.fall * M.die.fall); c.translate(0, -p.fall * 3); }
  c.rotate(s * p.lean);
  c.scale(1 + (1 - p.squash) * 0.6, p.squash);
  c.translate(0, -p.bob);

  c.save();
  c.scale(K, K);
  /** Draw rows y0..y1 and columns x0..x1 of this view, with the feet at the origin. */
  const piece = (y0: number, y1: number, x0 = 0, x1 = HERO_CELL_W) =>
    c.drawImage(img!, sx + x0, y0, x1 - x0, y1 - y0, x0 - HERO_CELL_W / 2, y0 - HERO_FEET_Y, x1 - x0, y1 - y0);
  const around = (px: number, py: number, rot: number, dy: number, draw: () => void) => {
    c.save();
    c.translate(px - HERO_CELL_W / 2, py - HERO_FEET_Y + dy);
    c.rotate(rot);
    c.translate(-(px - HERO_CELL_W / 2), -(py - HERO_FEET_Y));
    draw();
    c.restore();
  };

  // Legs swing from the trouser hem and lift a little; the far leg is drawn first.
  const legs = [
    { x0: 0, x1: f.split, ang: s > 0 ? p.legB : p.legA },
    { x0: f.split, x1: HERO_CELL_W, ang: s > 0 ? p.legA : p.legB },
  ];
  for (const l of legs) {
    const lift = Math.max(0, Math.abs(l.ang) - 0.1) * M.sprite.lift / K;
    around((l.x0 + l.x1) / 2, f.hem, -s * l.ang * M.sprite.leg, -lift, () => piece(f.hem - OVERLAP, HERO_CELL_H, l.x0, l.x1));
  }
  piece(f.neck - OVERLAP, f.hem + OVERLAP);
  around(HERO_CELL_W / 2, f.neck, s * p.headRot, p.headDy / K, () => {
    piece(f.sprout - 2, f.neck + OVERLAP);
    around(f.sproutX, f.sprout, s * p.sprout, 0, () => piece(0, f.sprout + OVERLAP));
  });
  c.restore();

  // A blade of rune-light in the hand while attacking or casting; the art carries no weapon.
  const drawn = Math.max(0, Math.min(1, (M.sword.rest - p.blade) / (M.sword.rest - M.sword.armed)));
  if (drawn > 0.02 || p.trail >= 0) {
    c.save();
    c.scale(s, 1);
    const dx = Math.sin(p.armF), dy = Math.cos(p.armF);
    const color = p.glow > 0 ? p.glowColor : '#bfeaff';
    if (p.trail >= 0) {
      const A = M.attack;
      const cur = A.raise + (A.end - A.raise) * Math.min(1, p.trail);
      const alpha = p.trail <= 1 ? 0.85 : 0.85 * (1 - (p.trail - 1) * 2);
      c.lineCap = 'round';
      c.beginPath();
      c.arc(HAND.x, HAND.y, BLADE, Math.PI / 2 - A.raise, Math.PI / 2 - cur);
      c.strokeStyle = `rgba(190,235,255,${alpha * 0.5})`;
      c.lineWidth = 8;
      c.stroke();
      c.beginPath();
      c.arc(HAND.x, HAND.y, BLADE + 1, Math.PI / 2 - (A.raise + (cur - A.raise) * 0.4), Math.PI / 2 - cur);
      c.strokeStyle = `rgba(255,255,255,${alpha})`;
      c.lineWidth = 2.4;
      c.stroke();
    }
    if (drawn > 0.02) {
      c.globalAlpha *= drawn;
      c.shadowColor = color;
      c.shadowBlur = 12;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(HAND.x, HAND.y);
      c.lineTo(HAND.x + dx * BLADE, HAND.y + dy * BLADE);
      c.strokeStyle = color;
      c.lineWidth = 5;
      c.stroke();
      c.strokeStyle = '#fff';
      c.lineWidth = 2;
      c.stroke();
      if (p.glow > 0) {
        c.beginPath();
        c.arc(HAND.x + dx * BLADE, HAND.y + dy * BLADE, 2.5 + 3.5 * p.glow, 0, Math.PI * 2);
        c.fillStyle = '#fff';
        c.fill();
      }
    }
    c.restore();
  }
  c.restore();
}
