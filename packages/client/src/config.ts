import { MAP_PIXEL_H, MAP_PIXEL_W } from '@shardfall/shared';

/** Room above line 0 for trees that stick out of the top row. */
const TOP_MARGIN = 120;

export const GAME_W = 1300;
export const GAME_H = Math.ceil(MAP_PIXEL_H + TOP_MARGIN + 12);

/** Screen offset of the map footprint inside the canvas. */
export const ORIGIN_X = Math.round((GAME_W - MAP_PIXEL_W) / 2);
export const ORIGIN_Y = TOP_MARGIN;

/** Walking speed in pixels per second. */
export const WALK_SPEED = 190;

/** MP shown by the combat range preview (base MP in the design doc). */
export const PREVIEW_MP = 3;

export const START_MAP_ID = 'brightmoor_0_0';
export const REGION_NAME = 'Brightmoor Isle';

/** Depth bands: ground < overlays < objects and units (sorted by foot y) < debug. */
export const DEPTH = {
  ground: 0,
  overlay: 5,
  sorted: 10,
  debug: 5000,
} as const;
