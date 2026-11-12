// Environment sprites from assets/env (the owner's own art): trees, the portal and one-sprite buildings.
// Placement and footprints come from assets/env/manifest.json; images are 3x and drawn at 1/3.
import manifest from '../../assets/env/manifest.json';
import marketStallUrl from '../../assets/env/market-stall.png';
import portalUrl from '../../assets/env/portal.png';
import shopUrl from '../../assets/env/shop.png';
import treeUrl from '../../assets/env/tree.png';
import type { Biome } from '../core/content.js';
import type { MapObj } from '../core/world.js';

type C = CanvasRenderingContext2D;
type Name = 'tree' | 'market-stall' | 'portal' | 'shop';
interface Entry { anchor3x: number[]; collisionPolygon1x: number[][] }

const URLS: Record<Name, string> = { tree: treeUrl, 'market-stall': marketStallUrl, portal: portalUrl, shop: shopUrl };
const ASSETS = manifest.assets as unknown as Record<Name, Entry>;
const images: Partial<Record<Name, HTMLImageElement>> = {};

/** Biomes whose trees and waystone (drawn as the portal) use these sprites. */
export const ENV_BIOMES: Biome[] = ['village', 'meadow'];

export function loadEnvSprites(): Promise<void> {
  return Promise.all((Object.keys(URLS) as Name[]).map((n) => new Promise<void>((done) => {
    const i = new Image();
    i.onload = () => { images[n] = i; done(); };
    i.onerror = () => done();
    i.src = URLS[n];
  }))).then(() => undefined);
}
export const envReady = (n: Name) => !!images[n];

/** Screen position of the centre of diamond cell (u, v); valid for any u, v. */
const uvScreen = (u: number, v: number) => ({ x: 48 + 32 * (u - v), y: 60 + 16 * (u + v) });

/** Offset from a footprint's centre to the sprite's anchor: the collision outline is centred on the footprint. */
function anchorOffset(n: Name): { x: number; y: number } {
  const poly = ASSETS[n].collisionPolygon1x;
  let x = 0, y = 0;
  for (const [px, py] of poly) { x += px!; y += py!; }
  return { x: -x / poly.length, y: -y / poly.length };
}

function drawImageAt(c: C, n: Name, ax: number, ay: number, flip = 1, scale = 1) {
  const img = images[n]!;
  const a = ASSETS[n].anchor3x;
  c.save();
  c.translate(ax, ay);
  c.scale(flip * scale, scale);
  c.drawImage(img, -a[0]! / 3, -a[1]! / 3, img.width / 3, img.height / 3);
  c.restore();
}

/** Cheap hash of a cell, for steady per-tree variation. */
const hash = (i: number) => {
  let h = (i + 1) * 2654435761;
  h ^= h >>> 15;
  return h >>> 0;
};

/** A tree on a cell centre: mirrored or not, 90 to 100% of full size. */
export function drawEnvTree(c: C, x: number, y: number, cell: number) {
  const h = hash(cell);
  const o = anchorOffset('tree');
  drawImageAt(c, 'tree', x + o.x, y + o.y, h & 1 ? -1 : 1, 0.9 + ((h >>> 1) % 11) / 100);
}

export function drawEnvPortal(c: C, x: number, y: number) {
  const o = anchorOffset('portal');
  drawImageAt(c, 'portal', x + o.x, y + o.y);
}

export interface DrawItem { y: number; x: number; draw: () => void }

/**
 * A building as vertical strips, each sorted by the front edge of the footprint under it, so
 * an actor north of the building is drawn behind it and an actor beside or south of it in front.
 * pixelScale snaps strip edges to device pixels so neighbouring strips meet without seams.
 */
export function buildingItems(c: C, o: MapObj, pixelScale: number): DrawItem[] {
  const n = o.asset!, f = o.foot!;
  if (!images[n]) return [];
  const u1 = f.u0 + f.w - 1, v1 = f.v0 + f.h - 1;
  const west = uvScreen(f.u0, v1), south = uvScreen(u1, v1), east = uvScreen(u1, f.v0);
  const W = { x: west.x - 32, y: west.y }, S = { x: south.x, y: south.y + 16 }, E = { x: east.x + 32, y: east.y };
  const mid = uvScreen((f.u0 + u1) / 2, (f.v0 + v1) / 2);
  const off = anchorOffset(n);
  const ax = mid.x + off.x, ay = mid.y + off.y;
  const img = images[n]!, a = ASSETS[n].anchor3x;
  const left = ax - a[0]! / 3, right = left + img.width / 3;
  const front = (x: number) => {
    const cx = Math.max(W.x, Math.min(E.x, x));
    return cx <= S.x ? W.y + (cx - W.x) * 0.5 : S.y - (cx - S.x) * 0.5;
  };
  const snap = (x: number) => Math.round(x * pixelScale) / pixelScale;
  const items: DrawItem[] = [];
  const first = W.x - Math.ceil((W.x - left) / 32) * 32;
  for (let x0 = first; x0 < right; x0 += 32) {
    const sx0 = snap(Math.max(x0, left - 1)), sx1 = snap(Math.min(x0 + 32, right + 1));
    if (sx1 <= sx0) continue;
    items.push({
      x: x0 + 16,
      y: front(x0 + 16),
      draw: () => {
        c.save();
        c.beginPath();
        c.rect(sx0, -1000, sx1 - sx0, 3000);
        c.clip();
        drawImageAt(c, n, ax, ay);
        c.restore();
      },
    });
  }
  return items;
}
