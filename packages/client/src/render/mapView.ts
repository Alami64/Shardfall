import Phaser from 'phaser';
import { CELL_COUNT, HALF_H, HALF_W, cellToScreen, type GameMap } from '@shardfall/shared';
import { sprite } from '../assets';
import { DEPTH, ORIGIN_X, ORIGIN_Y } from '../config';

/** Map-pixel centre of a cell, offset into canvas space. */
export function cellPos(cell: number) {
  const { sx, sy } = cellToScreen(cell);
  return { x: sx + ORIGIN_X, y: sy + ORIGIN_Y };
}

/** The four corners of a cell's diamond around (cx, cy), shrunk by `inset` pixels. */
export function diamond(cx: number, cy: number, inset = 0): Phaser.Math.Vector2[] {
  const w = HALF_W - inset * 2;
  const h = HALF_H - inset;
  return [
    new Phaser.Math.Vector2(cx, cy - h),
    new Phaser.Math.Vector2(cx + w, cy),
    new Phaser.Math.Vector2(cx, cy + h),
    new Phaser.Math.Vector2(cx - w, cy),
  ];
}

/** Places an image so its sprite anchor sits on the cell centre, depth-sorted by its feet. */
export function placeSprite(scene: Phaser.Scene, key: string, cell: number): Phaser.GameObjects.Image {
  const info = sprite(key);
  const { x, y } = cellPos(cell);
  return scene.add
    .image(x, y, key)
    .setOrigin(info.anchorX / info.width, info.anchorY / info.height)
    .setDepth(DEPTH.sorted + y);
}

export interface Occluder {
  img: Phaser.GameObjects.Image;
  bounds: Phaser.Geom.Rectangle;
}

/** Draws a map's ground and objects. Trees come back as occluders, to fade when a unit stands behind them. */
export function drawMap(scene: Phaser.Scene, map: GameMap): { objects: Phaser.GameObjects.GameObject[]; occluders: Occluder[] } {
  const objects: Phaser.GameObjects.GameObject[] = [];
  const occluders: Occluder[] = [];
  for (let c = 0; c < CELL_COUNT; c++) {
    const groundKey = map.tiles[map.ground[c]!]!;
    objects.push(placeSprite(scene, groundKey, c).setDepth(DEPTH.ground));
    const objIndex = map.objects[c]!;
    if (objIndex >= 0) {
      const key = map.tiles[objIndex]!;
      const img = placeSprite(scene, key, c);
      objects.push(img);
      if (key.startsWith('tree_')) occluders.push({ img, bounds: img.getBounds() });
    }
  }
  return { objects, occluders };
}

const scratch = new Phaser.Geom.Rectangle();

/** Fades every tree that stands in front of one of the given sprites. */
export function updateOccluders(occluders: readonly Occluder[], units: readonly Phaser.GameObjects.Image[]): void {
  for (const { img, bounds } of occluders) {
    let inFront = false;
    for (const u of units) {
      if (!u.visible || img.depth <= u.depth) continue;
      u.getBounds(scratch);
      // Shrink to the body so a leaf brushing a hood doesn't fade a whole tree.
      Phaser.Geom.Rectangle.Inflate(scratch, -10, -10);
      if (Phaser.Geom.Intersects.RectangleToRectangle(bounds, scratch)) {
        inFront = true;
        break;
      }
    }
    const alpha = inFront ? 0.5 : 1;
    if (img.alpha !== alpha) img.setAlpha(alpha);
  }
}
