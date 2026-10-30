/**
 * Converts every Tiled map in content/maps/*.tmj into the game's map format and
 * writes them together to content/maps/built/world.json.
 *
 * Per cell: the "ground" layer gives the floor tile, the "objects" layer an
 * optional object on top. Tile properties decide the cell flags:
 *   walkable  = ground is walkable AND (no object OR object is walkable)
 *   blocksLos = ground blocks OR object blocks
 * Every map names its `region`. The optional map properties `startA` and `startB` list the fight start cells
 * of each team as comma-separated cell ids; they must be walkable and distinct.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CELL_COUNT,
  CellFlag,
  EDGE_OFFSET,
  MAP_LINES,
  MAP_WIDTH,
  edgeCells,
  mapKey,
  validateMap,
  type Edge,
  type GameMap,
  type WorldData,
} from '@shardfall/shared';
import { GID_MASK, prop, tiledMapSchema, type TiledMap } from './tiled.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const MAPS_DIR = join(ROOT, 'content/maps');
const OUT_FILE = join(MAPS_DIR, 'built/world.json');

interface TileInfo {
  key: string;
  walkable: boolean;
  blocksLos: boolean;
}

function tileIndex(map: TiledMap, file: string): Map<number, TileInfo> {
  const byGid = new Map<number, TileInfo>();
  for (const ts of map.tilesets) {
    for (const t of ts.tiles) {
      const key = prop(t.properties, 'key');
      const walkable = prop(t.properties, 'walkable');
      const blocksLos = prop(t.properties, 'blocksLos');
      if (typeof key !== 'string') throw new Error(`${file}: tile ${t.id} in "${ts.name}" has no string "key" property`);
      byGid.set(ts.firstgid + t.id, {
        key,
        walkable: walkable !== false,
        blocksLos: blocksLos === true,
      });
    }
  }
  return byGid;
}

export function convert(raw: unknown, file: string): GameMap {
  const parsed = tiledMapSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${file}: not a supported Tiled map:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  const map = parsed.data;
  const tiles = tileIndex(map, file);
  const layer = (name: string) => {
    const l = map.layers.find((x) => x.name === name);
    if (!l) throw new Error(`${file}: missing tile layer "${name}"`);
    if (l.data.length !== CELL_COUNT) throw new Error(`${file}: layer "${name}" has ${l.data.length} cells, expected ${CELL_COUNT}`);
    return l.data;
  };
  const groundLayer = layer('ground');
  const objectLayer = layer('objects');

  const keys: string[] = [];
  const keyIndex = (key: string) => {
    let i = keys.indexOf(key);
    if (i === -1) i = keys.push(key) - 1;
    return i;
  };

  const ground: number[] = [];
  const objects: number[] = [];
  const flags: number[] = [];
  for (let c = 0; c < CELL_COUNT; c++) {
    const g = tiles.get(groundLayer[c]! & GID_MASK);
    if (!g) throw new Error(`${file}: cell ${c} has no ground tile`);
    const objGid = objectLayer[c]! & GID_MASK;
    const o = objGid ? tiles.get(objGid) : undefined;
    if (objGid && !o) throw new Error(`${file}: cell ${c} uses unknown object gid ${objGid}`);

    ground.push(keyIndex(g.key));
    objects.push(o ? keyIndex(o.key) : -1);
    let f = 0;
    if (g.walkable && (!o || o.walkable)) f |= CellFlag.Walkable;
    if (g.blocksLos || o?.blocksLos) f |= CellFlag.BlocksLineOfSight;
    flags.push(f);
  }

  const num = (name: string) => {
    const v = prop(map.properties, name);
    if (typeof v !== 'number') throw new Error(`${file}: map property "${name}" must be an int`);
    return v;
  };
  const str = (name: string) => {
    const v = prop(map.properties, name);
    if (typeof v !== 'string' || !v) throw new Error(`${file}: map property "${name}" must be a string`);
    return v;
  };

  // Fight start cells, one list per team.
  const startCells = (name: string, flag: number, taken: Set<number>) => {
    const v = prop(map.properties, name);
    if (v === undefined) return;
    if (typeof v !== 'string') throw new Error(`${file}: map property "${name}" must be a string of cell ids`);
    for (const part of v.split(',')) {
      const c = Number(part.trim());
      if (!Number.isInteger(c) || c < 0 || c >= CELL_COUNT) throw new Error(`${file}: ${name}: "${part}" is not a cell id`);
      if (!(flags[c]! & CellFlag.Walkable)) throw new Error(`${file}: ${name}: cell ${c} is not walkable`);
      if (taken.has(c)) throw new Error(`${file}: ${name}: cell ${c} is listed twice`);
      taken.add(c);
      flags[c]! |= flag;
    }
  };
  const taken = new Set<number>();
  startCells('startA', CellFlag.StartTeamA, taken);
  startCells('startB', CellFlag.StartTeamB, taken);

  const out: GameMap = {
    id: str('id'),
    name: str('name'),
    region: str('region'),
    worldX: num('worldX'),
    worldY: num('worldY'),
    width: MAP_WIDTH,
    lines: MAP_LINES,
    ground,
    objects,
    flags,
    tiles: keys,
  };
  const errors = validateMap(out);
  if (errors.length) throw new Error(`${file}: ${errors.join('; ')}`);
  return out;
}

function main() {
  const files = readdirSync(MAPS_DIR).filter((f) => f.endsWith('.tmj')).sort();
  if (files.length === 0) throw new Error(`no .tmj maps in ${relative(ROOT, MAPS_DIR)}; run npm run maps:generate`);
  const maps = files.map((f) => convert(JSON.parse(readFileSync(join(MAPS_DIR, f), 'utf8')), f));

  // Cross-map checks: unique ids and coordinates, and open exits towards every neighbour.
  const byCoord = new Map<string, GameMap>();
  for (const m of maps) {
    const k = mapKey(m.worldX, m.worldY);
    const clash = byCoord.get(k);
    if (clash) throw new Error(`maps ${clash.id} and ${m.id} both sit at world ${k}`);
    byCoord.set(k, m);
  }
  if (new Set(maps.map((m) => m.id)).size !== maps.length) throw new Error('duplicate map ids');
  for (const m of maps) {
    for (const edge of Object.keys(EDGE_OFFSET) as Edge[]) {
      const { dx, dy } = EDGE_OFFSET[edge];
      const next = byCoord.get(mapKey(m.worldX + dx, m.worldY + dy));
      if (next && edgeCells(m, edge).length === 0) {
        console.warn(`warning: ${m.id} has a neighbour to the ${edge} (${next.id}) but no walkable ${edge} edge cell`);
      }
    }
  }

  const world: WorldData = { maps };
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(world) + '\n');
  console.log(`converted ${maps.length} map(s) -> ${relative(ROOT, OUT_FILE)}`);
}

main();
