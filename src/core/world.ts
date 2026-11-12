// Maps: generation per biome, the village layout, exits, monster groups.
import { MONSTERS, mapAt, BOSS_LEVEL, type MapDef } from './content.js';
import type { HeroLook } from './character.js';
import type { Fighter } from './fight.js';
import { CELLS, COLS, ROWS, cellAt, colOf, dist, fromUV, neighbors, rowOf, uv } from './grid.js';
import { findPath } from './path.js';
import { createRng, rint, type Rng } from './rng.js';

export type Dir = 'up' | 'down' | 'left' | 'right';
export interface MapObj {
  kind: string;
  variant: number;
  /** Block corner heights: north, east, south, west. */
  h?: [number, number, number, number];
  wall?: string;
  roof?: string;
  door?: 'L' | 'R';
  window?: boolean;
  /** A building drawn as one sprite over several cells; every cell of it carries the same values. */
  asset?: 'shop' | 'market-stall';
  /** Footprint of that building in diamond coordinates: u0..u0+w-1, v0..v0+h-1. */
  foot?: { u0: number; v0: number; w: number; h: number };
}
export interface Npc { id: string; name: string; title: string; cell: number; role: 'shop' | 'quest' | 'heal'; look: HeroLook }
export interface GroupMember { def: string; level: number }
export interface Group { id: number; cell: number; members: GroupMember[]; boss?: boolean }
export interface GameMap {
  def: MapDef;
  ground: Uint8Array;
  water: boolean[];
  road: boolean[];
  obj: (MapObj | null)[];
  walkable: boolean[];
  opaque: boolean[];
  exits: (Dir | null)[];
  npcs: Npc[];
  groups: Group[];
  /** Times (ms) at which a missing group comes back. */
  respawns: number[];
  /** Time (ms) from which the boss group may come back. */
  bossAt: number;
  spawn: number;
}

/** Scenery that blocks line of sight. Everything listed in a map's obj blocks walking. */
const OPAQUE = new Set(['tree', 'pine', 'deadtree', 'rock', 'pillar', 'block', 'shroom', 'stone', 'building']);

export const DIR_DELTA: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
export const neighborMap = (def: MapDef, dir: Dir) => mapAt(def.gx + DIR_DELTA[dir][0], def.gy + DIR_DELTA[dir][1]);

function borderInfo(i: number): { dir: Dir; depth: number }[] {
  const c = colOf(i), r = rowOf(i), out: { dir: Dir; depth: number }[] = [];
  if (r <= 2) out.push({ dir: 'up', depth: r });
  if (r >= ROWS - 3) out.push({ dir: 'down', depth: ROWS - 1 - r });
  // Staggered rows: even rows reach further left, odd rows further right.
  if (c === 0) out.push({ dir: 'left', depth: r & 1 });
  if (c === 1 && !(r & 1)) out.push({ dir: 'left', depth: 2 });
  if (c === COLS - 1) out.push({ dir: 'right', depth: r & 1 ? 0 : 1 });
  if (c === COLS - 2 && r & 1) out.push({ dir: 'right', depth: 2 });
  return out;
}

function exitOf(i: number): Dir | null {
  const c = colOf(i), r = rowOf(i);
  if (r === 0) return 'up';
  if (r === ROWS - 1) return 'down';
  if (c === 0 && !(r & 1) && r >= 2 && r <= ROWS - 3) return 'left';
  if (c === COLS - 1 && r & 1 && r >= 3 && r <= ROWS - 4) return 'right';
  return null;
}

/** Where you arrive in the next map after leaving through an exit cell. */
export function arrivalCell(map: GameMap, fromExit: number, dir: Dir): number {
  const c = colOf(fromExit), r = rowOf(fromExit);
  let want: number;
  if (dir === 'up') want = cellAt(c, ROWS - 3);
  else if (dir === 'down') want = cellAt(c, 2);
  else if (dir === 'left') want = cellAt(COLS - 2, Math.min(ROWS - 2, r + 1));
  else want = cellAt(1, Math.max(0, r - 1));
  return nearestWalkable(map, want);
}

export function nearestWalkable(map: GameMap, cell: number): number {
  if (map.walkable[cell]) return cell;
  let best = map.spawn, bestD = Infinity;
  for (let i = 0; i < CELLS; i++) {
    if (!map.walkable[i]) continue;
    const d = dist(i, cell);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

const BORDER_KIND: Record<string, string[]> = {
  village: ['tree', 'tree', 'bush'], meadow: ['tree', 'tree', 'bush', 'rock'], forest: ['tree', 'pine', 'pine'],
  marsh: ['deadtree', 'rock', 'bush'], ruins: ['pillar', 'rock', 'rock'], hollow: ['root', 'rock', 'shroom'],
};

const SCATTER: Record<string, [string, number][]> = {
  village: [],
  meadow: [['tree', 0.03], ['bush', 0.03], ['rock', 0.015]],
  forest: [['tree', 0.085], ['pine', 0.05], ['bush', 0.03], ['stump', 0.015], ['rock', 0.01]],
  marsh: [['deadtree', 0.04], ['bush', 0.035], ['rock', 0.015]],
  ruins: [['pillar', 0.04], ['rock', 0.03], ['deadtree', 0.012], ['rubble', 0.03]],
  hollow: [['root', 0.06], ['shroom', 0.04], ['rock', 0.02], ['deadtree', 0.025]],
};

function addHouse(map: GameMap, u0: number, v0: number, w: number, h: number, wall: string, roof: string) {
  const H = 38, R = 20;
  for (let u = u0; u < u0 + w; u++) {
    for (let v = v0; v < v0 + h; v++) {
      const cell = fromUV(u, v);
      if (cell < 0) continue;
      let hs: [number, number, number, number] = [H, H, H, H];
      let door: 'L' | 'R' | undefined;
      if (w >= h && h === 2) {
        hs = v === v0 ? [H, H, H + R, H + R] : [H + R, H + R, H, H];
        if (v === v0 + 1 && u === u0 + Math.floor(w / 2)) door = 'L';
      } else if (w === 2) {
        hs = u === u0 ? [H, H + R, H + R, H] : [H + R, H, H, H + R];
        if (u === u0 + 1 && v === v0 + Math.floor(h / 2)) door = 'R';
      }
      map.obj[cell] = { kind: 'block', variant: (u + v) & 3, h: hs, wall, roof, door, window: !door };
    }
  }
}

/** A building that is one sprite over a block of cells (see MapObj.asset). */
function addBuilding(map: GameMap, asset: NonNullable<MapObj['asset']>, u0: number, v0: number, w: number, h: number) {
  const foot = { u0, v0, w, h };
  for (let u = u0; u < u0 + w; u++) {
    for (let v = v0; v < v0 + h; v++) {
      const cell = fromUV(u, v);
      if (cell >= 0) map.obj[cell] = { kind: 'building', variant: 0, asset, foot };
    }
  }
}

function buildVillage(map: GameMap, rng: Rng) {
  for (let i = 0; i < CELLS; i++) {
    const c = colOf(i), r = rowOf(i);
    if ((r >= 13 && r <= 17) || ((c === 6 || c === 7) && r >= 15)) map.road[i] = true;
  }
  addBuilding(map, 'shop', 6, 0, 3, 2);
  addBuilding(map, 'market-stall', 10, -1, 1, 2);
  addHouse(map, 13, -7, 2, 3, '#e3d2c0', '#4f7a9c');
  addHouse(map, 13, 8, 3, 2, '#dcd0b0', '#6b8f4a');
  addHouse(map, 21, -1, 2, 3, '#e8d8b8', '#8a5a9c');
  const put = (u: number, v: number, kind: string) => {
    const c = fromUV(u, v);
    if (c >= 0 && !map.obj[c]) map.obj[c] = { kind, variant: rint(rng, 0, 3) };
  };
  put(13, -2, 'stone');
  put(9, 2, 'crate'); put(10, 2, 'crate'); put(5, 1, 'barrel');
  put(11, -3, 'lamp'); put(17, 1, 'lamp'); put(12, 5, 'lamp'); put(19, -5, 'lamp');
  put(18, 6, 'well');
  put(16, -8, 'barrel'); put(24, 1, 'crate'); put(16, 10, 'barrel');
  for (let i = 0; i < CELLS; i++) {
    if (map.obj[i] || map.road[i]) continue;
    const r = rng();
    // Trees keep a cell of space around houses and stalls so they don't hide them.
    const nearHouse = neighbors(i).some((n) => map.obj[n]?.kind === 'block' || map.obj[n]?.kind === 'building');
    if (r < 0.035 && !nearHouse) map.obj[i] = { kind: 'tree', variant: rint(rng, 0, 3) };
    else if (r < 0.06) map.obj[i] = { kind: 'bush', variant: rint(rng, 0, 3) };
  }
  const npc = (id: string, name: string, title: string, role: Npc['role'], u: number, v: number, look: HeroLook) => {
    const cell = fromUV(u, v);
    map.obj[cell] = null;
    map.npcs.push({ id, name, title, cell, role, look });
  };
  npc('maren', 'Maren', 'Quartermaster', 'shop', 7, 2, { tunic: '#b5533c', hair: '#3a2a20', skin: '#e9b98f' });
  npc('elin', 'Sister Elin', 'Healer', 'heal', 15, -6, { tunic: '#e9e4d8', hair: '#c9a23a', skin: '#f0c9a4' });
  npc('tobin', 'Old Tobin', 'Warden of Emberhollow', 'quest', 14, -1, { tunic: '#4f6a8c', hair: '#d8d8d8', skin: '#d9a784' });
  map.spawn = fromUV(15, 0);
}

function scatter(map: GameMap, rng: Rng) {
  const biome = map.def.biome;
  if (biome === 'marsh') {
    for (let k = 0; k < 6; k++) {
      const [cu, cv] = uv(rint(rng, 0, CELLS - 1));
      const rad = rint(rng, 1, 3);
      for (let du = -rad; du <= rad; du++) {
        for (let dv = -rad; dv <= rad; dv++) {
          const c = fromUV(cu + du, cv + dv);
          if (c >= 0 && Math.abs(du) + Math.abs(dv) <= rad && rng() < 0.8) map.water[c] = true;
        }
      }
    }
  }
  if (biome === 'ruins') {
    // Broken walls: short runs of low blocks.
    for (let k = 0; k < 7; k++) {
      let [u, v] = uv(rint(rng, 0, CELLS - 1));
      const along = rng() < 0.5;
      for (let n = rint(rng, 2, 4); n > 0; n--) {
        const c = fromUV(u, v);
        if (c >= 0) {
          const h = rint(rng, 14, 30);
          map.obj[c] = { kind: 'block', variant: rint(rng, 0, 3), h: [h, h - rint(rng, 0, 8), h, h - rint(rng, 0, 8)], wall: '#9a958c', roof: '#b3aea4' };
        }
        if (along) u++; else v++;
      }
    }
  }
  if (biome === 'meadow' || biome === 'forest') {
    for (let k = 0; k < (biome === 'forest' ? 5 : 2); k++) {
      const [cu, cv] = uv(rint(rng, 0, CELLS - 1));
      for (let du = -2; du <= 2; du++) {
        for (let dv = -2; dv <= 2; dv++) {
          const c = fromUV(cu + du, cv + dv);
          if (c >= 0 && Math.abs(du) + Math.abs(dv) <= 2 && rng() < 0.4) map.obj[c] = { kind: rng() < 0.3 && biome === 'forest' ? 'pine' : 'tree', variant: rint(rng, 0, 3) };
        }
      }
    }
  }
  for (let i = 0; i < CELLS; i++) {
    if (map.obj[i] || map.water[i]) continue;
    let r = rng();
    for (const [kind, p] of SCATTER[biome]!) {
      if (r < p) { map.obj[i] = { kind, variant: rint(rng, 0, 3) }; break; }
      r -= p;
    }
  }
}

export function buildMap(def: MapDef): GameMap {
  const rng = createRng(def.seed * 7919);
  const map: GameMap = {
    def, ground: new Uint8Array(CELLS), water: new Array(CELLS).fill(false), road: new Array(CELLS).fill(false),
    obj: new Array(CELLS).fill(null), walkable: [], opaque: [], exits: new Array(CELLS).fill(null),
    npcs: [], groups: [], respawns: [], bossAt: 0, spawn: cellAt(7, 15),
  };
  for (let i = 0; i < CELLS; i++) map.ground[i] = rint(rng, 0, 3);
  if (def.biome === 'village') buildVillage(map, rng);
  else scatter(map, rng);

  // Borders: open towards a neighbouring map, overgrown otherwise.
  const kinds = BORDER_KIND[def.biome]!;
  for (let i = 0; i < CELLS; i++) {
    const info = borderInfo(i);
    if (!info.length) continue;
    const open = info.some((b) => neighborMap(def, b.dir));
    const closed = info.filter((b) => !neighborMap(def, b.dir));
    if (closed.length) {
      const depth = Math.min(...closed.map((b) => b.depth));
      const p = depth === 0 ? 0.92 : depth === 1 ? 0.45 : 0;
      if (rng() < p && !(open && depth > 0)) {
        map.obj[i] = { kind: kinds[rint(rng, 0, kinds.length - 1)]!, variant: rint(rng, 0, 3) };
        map.water[i] = false;
        continue;
      }
    }
    if (open && !closed.some((b) => b.depth === 0)) {
      if ((map.obj[i]?.kind !== 'block' && map.obj[i]?.kind !== 'building') || def.biome !== 'village') map.obj[i] = null;
      map.water[i] = false;
      const dir = exitOf(i);
      if (dir && neighborMap(def, dir)) map.exits[i] = dir;
    }
  }

  const refresh = () => {
    for (let i = 0; i < CELLS; i++) {
      const blockedByNpc = map.npcs.some((n) => n.cell === i);
      map.walkable[i] = !map.obj[i] && !map.water[i] && !blockedByNpc;
      map.opaque[i] = !!map.obj[i] && OPAQUE.has(map.obj[i]!.kind);
    }
  };
  refresh();
  if (!map.walkable[map.spawn]) { map.obj[map.spawn] = null; map.water[map.spawn] = false; refresh(); }

  // Make every walkable cell reachable from the spawn: carve towards it.
  for (let guard = 0; guard < 200; guard++) {
    const seen = new Uint8Array(CELLS);
    const queue = [map.spawn];
    seen[map.spawn] = 1;
    for (let q = 0; q < queue.length; q++) {
      for (const n of neighbors(queue[q]!)) if (!seen[n] && map.walkable[n]) { seen[n] = 1; queue.push(n); }
    }
    let lost = -1;
    for (let i = 0; i < CELLS && lost < 0; i++) if (map.walkable[i] && !seen[i]) lost = i;
    if (lost < 0) break;
    const path = findPath(lost, (i) => !!seen[i], (i) => map.obj[i]?.kind !== 'block' && map.obj[i]?.kind !== 'building' && !map.npcs.some((n) => n.cell === i));
    if (!path) { map.obj[lost] = { kind: 'rock', variant: 0 }; refresh(); continue; }
    for (const c of path) { map.obj[c] = null; map.water[c] = false; }
    refresh();
  }
  return map;
}

// ------------------------------------------------------------ monster groups

let groupSeq = 1;

function weighted(rng: Rng, pool: [string, number][]): string {
  let total = 0;
  for (const [, w] of pool) total += w;
  let r = rng() * total;
  for (const [id, w] of pool) { if (r < w) return id; r -= w; }
  return pool[0]![0];
}

function groupCell(map: GameMap, rng: Rng, avoid: number): number {
  for (let tries = 0; tries < 300; tries++) {
    const c = cellAt(rint(rng, 2, COLS - 3), rint(rng, 5, ROWS - 6));
    if (c < 0 || !map.walkable[c]) continue;
    if (avoid >= 0 && dist(c, avoid) < 7) continue;
    if (map.groups.some((g) => dist(g.cell, c) < 6)) continue;
    return c;
  }
  return -1;
}

export function spawnGroup(map: GameMap, rng: Rng, avoid = -1, boss = false): Group | null {
  const def = map.def;
  if (!def.pool || !def.levels) return null;
  const cell = groupCell(map, rng, avoid);
  if (cell < 0) return null;
  const members: GroupMember[] = [];
  if (boss) {
    members.push({ def: 'thornmaw', level: BOSS_LEVEL });
    members.push({ def: 'briarling', level: def.levels[1] }, { def: 'briarling', level: def.levels[0] });
  } else {
    const n = rint(rng, def.size![0], def.size![1]);
    for (let k = 0; k < n; k++) members.push({ def: weighted(rng, def.pool), level: rint(rng, def.levels[0], def.levels[1]) });
    members.sort((a, b) => b.level - a.level);
  }
  const g: Group = { id: groupSeq++, cell, members, boss };
  map.groups.push(g);
  return g;
}

/** Fill the map with monster groups. Groups whose respawn time has not come yet stay away. */
export function populate(map: GameMap, rng: Rng, avoid = -1, now = Infinity): Group[] {
  const added: Group[] = [];
  if (!map.def.groups) return added;
  if (map.def.boss && !map.groups.some((g) => g.boss) && now >= map.bossAt) {
    const g = spawnGroup(map, rng, avoid, true);
    if (g) added.push(g);
  }
  map.respawns = map.respawns.filter((t) => t > now);
  while (map.groups.filter((g) => !g.boss).length < map.def.groups - map.respawns.length) {
    const g = spawnGroup(map, rng, avoid);
    if (!g) break;
    added.push(g);
  }
  return added;
}

export function monsterFighter(defId: string, level: number, cell: number): Fighter {
  const d = MONSTERS[defId]!;
  const stat = Math.round(d.stat[0] + d.stat[1] * level);
  const hp = Math.round(d.hp[0] + d.hp[1] * level);
  const agi = Math.round(d.agi[0] + d.agi[1] * level);
  return {
    id: 0, team: 1, name: d.name, kind: defId, level, cell, hp, maxHp: hp,
    ap: d.ap, mp: d.mp, baseAp: d.ap, baseMp: d.mp,
    str: stat, int: stat, agi: d.spells.includes('m_spark') ? stat : agi, luck: 0, power: 0, dmg: 0, crit: 3,
    init: 80 + agi + level * 2, res: { ...d.res },
    spells: d.spells.map((id) => ({ id, rank: 1, cd: 0, used: 0 })), buffs: [], alive: true, ai: d.ai,
  };
}

/** Start cells for a fight: monsters around their group, the player's choices a few cells away. */
export function fightCells(map: GameMap, group: Group, playerCell: number, rng: Rng): { monsters: number[]; player: number[] } {
  const order: number[] = [];
  const seen = new Set<number>([group.cell]);
  const queue = [group.cell];
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q]!;
    order.push(c);
    for (const n of neighbors(c)) if (!seen.has(n) && map.walkable[n]) { seen.add(n); queue.push(n); }
  }
  const monsters: number[] = [group.cell];
  const near = order.filter((c) => dist(c, group.cell) <= 3 && c !== group.cell);
  while (monsters.length < group.members.length && near.length) {
    const c = near.splice(Math.floor(rng() * near.length), 1)[0]!;
    if (monsters.every((m) => dist(m, c) >= 2) || near.length < 4) monsters.push(c);
  }
  let player: number[] = [];
  for (let minD = 5; minD >= 2 && player.length < 3; minD--) {
    player = order
      .filter((c) => !monsters.includes(c) && monsters.every((m) => dist(m, c) >= minD) && dist(c, group.cell) <= minD + 4)
      .sort((a, b) => dist(a, playerCell) - dist(b, playerCell))
      .slice(0, 8);
  }
  if (!player.length) player = [playerCell];
  return { monsters, player };
}
