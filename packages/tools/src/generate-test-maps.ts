/**
 * Generates the two M0 test maps as Tiled files (content/maps/*.tmj), so they
 * can be opened and edited in Tiled. Run once; after that, edit in Tiled and
 * use `npm run maps:build` to convert.
 *
 *   brightmoor_0_0  Brightmoor Meadow    grass, a pond, trees along the edges
 *   brightmoor_1_0  Brightmoor Crossing  a stone square where the road crosses
 *
 * The road runs east-west across both maps and lines up at their shared edge.
 * Each map also gets fight start cells: six per team, on open ground around the
 * road, team A to the west and team B to the east (map properties startA/startB).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CELL_COUNT,
  MAP_LINES,
  MAP_PIXEL_H,
  MAP_PIXEL_W,
  MAP_WIDTH,
  cellLine,
  cellToScreen,
  findPath,
} from '@shardfall/shared';
import type { TiledMap, TiledTileset } from './tiled.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const MAPS_DIR = join(ROOT, 'content/maps');
const TILES_DIR = join(ROOT, 'assets/tiles');

interface SpriteInfo {
  kind: 'ground' | 'object' | 'character';
  width: number;
  height: number;
}
const manifest = JSON.parse(readFileSync(join(TILES_DIR, 'manifest.json'), 'utf8')) as Record<string, SpriteInfo>;

/** Gameplay properties per tile key; this is the source of truth for cell flags. */
const TILE_RULES: Record<string, { walkable: boolean; blocksLos: boolean }> = {
  grass_1: { walkable: true, blocksLos: false },
  grass_2: { walkable: true, blocksLos: false },
  grass_3: { walkable: true, blocksLos: false },
  flowers: { walkable: true, blocksLos: false },
  path: { walkable: true, blocksLos: false },
  stone: { walkable: true, blocksLos: false },
  water: { walkable: false, blocksLos: false },
  tree_oak: { walkable: false, blocksLos: true },
  tree_pine: { walkable: false, blocksLos: true },
  rock: { walkable: false, blocksLos: false },
  bush: { walkable: false, blocksLos: false },
};

/** Fight start cells per team. */
const START_CELLS = 6;

const GROUND_KEYS = ['grass_1', 'grass_2', 'grass_3', 'flowers', 'path', 'stone', 'water'];
const OBJECT_KEYS = ['tree_oak', 'tree_pine', 'rock', 'bush'];

function makeTileset(name: string, firstgid: number, keys: string[]): TiledTileset {
  const infos = keys.map((k) => {
    const info = manifest[k];
    if (!info) throw new Error(`missing sprite "${k}" in manifest; run npm run art`);
    return info;
  });
  return {
    firstgid,
    name,
    tilewidth: Math.max(...infos.map((i) => i.width)),
    tileheight: Math.max(...infos.map((i) => i.height)),
    tilecount: keys.length,
    columns: 0,
    // Ground images are 2 px larger than a cell; nudge them back onto the grid in Tiled.
    ...(name === 'ground' ? { tileoffset: { x: -1, y: 1 } } : {}),
    tiles: keys.map((key, id) => ({
      id,
      image: relative(MAPS_DIR, join(TILES_DIR, `${key}.png`)),
      imagewidth: infos[id]!.width,
      imageheight: infos[id]!.height,
      properties: [
        { name: 'key', type: 'string', value: key },
        { name: 'walkable', type: 'bool', value: TILE_RULES[key]!.walkable },
        { name: 'blocksLos', type: 'bool', value: TILE_RULES[key]!.blocksLos },
      ],
    })),
  };
}

/** Small deterministic PRNG (mulberry32) so regenerating gives the same maps. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Road centre line in world pixels, continuous across maps placed side by side. */
const roadY = (worldPx: number) => MAP_PIXEL_H * 0.52 + 70 * Math.sin(worldPx / 260) + 25 * Math.sin(worldPx / 97);

interface MapSpec {
  id: string;
  name: string;
  worldX: number;
  worldY: number;
  seed: number;
  decorate: (ground: string[], objects: (string | null)[], rand: () => number) => void;
}

function buildMap(spec: MapSpec): TiledMap {
  const rand = rng(spec.seed);
  const ground: string[] = new Array(CELL_COUNT);
  const objects: (string | null)[] = new Array(CELL_COUNT).fill(null);

  for (let c = 0; c < CELL_COUNT; c++) {
    const r = rand();
    ground[c] = r < 0.06 ? 'flowers' : r < 0.4 ? 'grass_2' : r < 0.7 ? 'grass_1' : 'grass_3';
    const { sx, sy } = cellToScreen(c);
    const wx = sx + spec.worldX * MAP_PIXEL_W;
    if (Math.abs(sy - roadY(wx)) < 26) ground[c] = 'path';
  }

  spec.decorate(ground, objects, rand);

  // Trees along the north and south edges, thinning towards the middle; never on the road.
  for (let c = 0; c < CELL_COUNT; c++) {
    if (ground[c] === 'path' || ground[c] === 'water' || ground[c] === 'stone' || objects[c]) continue;
    const line = cellLine(c);
    const fromEdge = Math.min(line, MAP_LINES - 1 - line);
    const p = fromEdge <= 1 ? 0.55 : fromEdge <= 4 ? 0.25 : 0.04;
    const r = rand();
    if (r < p) objects[c] = rand() < 0.6 ? 'tree_oak' : 'tree_pine';
    else if (r < p + 0.03) objects[c] = 'rock';
    else if (r < p + 0.06) objects[c] = 'bush';
  }

  // Turn any walkable pocket the road cannot reach into bushes, so every open cell is reachable.
  const walk = (c: number) => TILE_RULES[ground[c]!]!.walkable && !(objects[c] && !TILE_RULES[objects[c]!]!.walkable);
  const start = ground.findIndex((g) => g === 'path');
  for (let c = 0; c < CELL_COUNT; c++) {
    if (walk(c) && c !== start && findPath(start, c, walk, { diagonals: true }) === null) objects[c] = 'bush';
  }

  // Fight start cells: the open cells nearest two points on the road, west (A) and east (B).
  const open = (c: number) => walk(c) && ground[c] !== 'water';
  const nearest = (fx: number, taken: Set<number>) => {
    const wx = fx * MAP_PIXEL_W;
    const cy = roadY(wx + spec.worldX * MAP_PIXEL_W);
    const cells = [...Array(CELL_COUNT).keys()].filter((c) => open(c) && !taken.has(c));
    const gap = (c: number) => Math.hypot(cellToScreen(c).sx - wx, (cellToScreen(c).sy - cy) * 2);
    const picked = cells.sort((a, b) => gap(a) - gap(b) || a - b).slice(0, START_CELLS);
    for (const c of picked) taken.add(c);
    return picked.sort((a, b) => a - b);
  };
  const taken = new Set<number>();
  const startA = nearest(0.3, taken);
  const startB = nearest(0.62, taken);

  const groundTs = makeTileset('ground', 1, GROUND_KEYS);
  const objectTs = makeTileset('objects', 1 + GROUND_KEYS.length, OBJECT_KEYS);
  const gid = (ts: TiledTileset, keys: string[], key: string) => ts.firstgid + keys.indexOf(key);

  return {
    type: 'map',
    orientation: 'staggered',
    staggeraxis: 'y',
    staggerindex: 'odd',
    width: MAP_WIDTH,
    height: MAP_LINES,
    tilewidth: 86,
    tileheight: 43,
    infinite: false,
    properties: [
      { name: 'id', type: 'string', value: spec.id },
      { name: 'name', type: 'string', value: spec.name },
      { name: 'worldX', type: 'int', value: spec.worldX },
      { name: 'worldY', type: 'int', value: spec.worldY },
      { name: 'startA', type: 'string', value: startA.join(',') },
      { name: 'startB', type: 'string', value: startB.join(',') },
    ],
    layers: [
      { id: 1, name: 'ground', type: 'tilelayer', width: MAP_WIDTH, height: MAP_LINES, x: 0, y: 0, opacity: 1, visible: true, data: ground.map((k) => gid(groundTs, GROUND_KEYS, k)) },
      { id: 2, name: 'objects', type: 'tilelayer', width: MAP_WIDTH, height: MAP_LINES, x: 0, y: 0, opacity: 1, visible: true, data: objects.map((k) => (k ? gid(objectTs, OBJECT_KEYS, k) : 0)) },
    ],
    tilesets: [groundTs, objectTs],
  };
}

const ellipse = (cx: number, cy: number, rx: number, ry: number) => (c: number) => {
  const { sx, sy } = cellToScreen(c);
  return ((sx - cx) / rx) ** 2 + ((sy - cy) / ry) ** 2 <= 1;
};

const specs: MapSpec[] = [
  {
    id: 'brightmoor_0_0',
    name: 'Brightmoor Meadow',
    worldX: 0,
    worldY: 0,
    seed: 11,
    decorate(ground, objects, rand) {
      const pond = ellipse(MAP_PIXEL_W * 0.3, MAP_PIXEL_H * 0.27, 170, 90);
      const shore = ellipse(MAP_PIXEL_W * 0.3, MAP_PIXEL_H * 0.27, 215, 120);
      for (let c = 0; c < CELL_COUNT; c++) {
        if (ground[c] === 'path') continue;
        if (pond(c)) ground[c] = 'water';
        else if (shore(c) && rand() < 0.35) ground[c] = 'flowers';
      }
      // A rock garden on the south side.
      for (let c = 0; c < CELL_COUNT; c++) {
        const { sx, sy } = cellToScreen(c);
        if (ground[c] !== 'path' && Math.abs(sx - MAP_PIXEL_W * 0.68) < 90 && Math.abs(sy - MAP_PIXEL_H * 0.74) < 50 && rand() < 0.3) objects[c] = 'rock';
      }
    },
  },
  {
    id: 'brightmoor_1_0',
    name: 'Brightmoor Crossing',
    worldX: 1,
    worldY: 0,
    seed: 23,
    decorate(ground, objects, rand) {
      const square = ellipse(MAP_PIXEL_W * 0.55, MAP_PIXEL_H * 0.5, 260, 150);
      for (let c = 0; c < CELL_COUNT; c++) {
        if (square(c)) ground[c] = 'stone';
      }
      // A north-south lane leaving the square.
      for (let c = 0; c < CELL_COUNT; c++) {
        const { sx } = cellToScreen(c);
        if (ground[c] !== 'stone' && Math.abs(sx - MAP_PIXEL_W * 0.55) < 30) ground[c] = 'path';
      }
      // Bushes framing the square.
      const ring = ellipse(MAP_PIXEL_W * 0.55, MAP_PIXEL_H * 0.5, 300, 180);
      for (let c = 0; c < CELL_COUNT; c++) {
        if (ring(c) && !square(c) && ground[c] !== 'path' && rand() < 0.3) objects[c] = 'bush';
      }
    },
  },
];

mkdirSync(MAPS_DIR, { recursive: true });
for (const spec of specs) {
  const map = buildMap(spec);
  const file = join(MAPS_DIR, `${spec.id}.tmj`);
  writeFileSync(file, JSON.stringify(map) + '\n');
  console.log(`wrote ${relative(ROOT, file)}`);
}
