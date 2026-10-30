import Phaser from 'phaser';
import {
  CELL_COUNT,
  Direction,
  EDGE_OFFSET,
  HALF_H,
  HALF_W,
  OPPOSITE_EDGE,
  neighbors,
  blocksLineOfSight,
  cellEdges,
  cellToGrid,
  cellToScreen,
  directionBetween,
  edgeCells,
  findPath,
  isWalkable,
  mapKey,
  reachableCells,
  screenToCell,
  type Edge,
  type GameMap,
} from '@shardfall/shared';
import { monsters, sprite, world } from '../assets';
import { DEPTH, ORIGIN_X, ORIGIN_Y, PREVIEW_MP, REGION_NAME, WALK_SPEED } from '../config';
import { ENCOUNTERS, monsterLook, partySetups, textureOf, type Encounter } from '../fight/setup';
import { SELECTED_HERO, type FightSceneData } from './FightScene';
import { hud } from '../hud';
import { cellPos, diamond, drawMap, placeSprite, updateOccluders, type Occluder } from '../render/mapView';
import { bar } from '../ui/bar';
import { viewOfSetup } from '../ui/characters';
import { windows } from '../ui/windows';

const COLORS = {
  path: 0xfff6dc,
  target: 0xfff6dc,
  blocked: 0xe0533d,
  exit: 0xf2a541,
  fight: 0xe8704f,
  range: 0x3fc1b0,
  debugGrid: 0xffffff,
  debugBlocked: 0xe0533d,
  debugSight: 0x1b1b1b,
} as const;

const OBJECT_LABELS: Record<string, string> = {
  tree_oak: 'an oak',
  tree_pine: 'a pine',
  rock: 'a rock',
  bush: 'a bush',
};

const EDGE_VECTOR: Record<Edge, { x: number; y: number }> = {
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
};

/** Registry key holding the ids of encounters beaten this session. */
const DEFEATED = 'defeatedEncounters';

export interface MapSceneData {
  mapId: string;
  /** Where the hero stands; defaults to the road. */
  cell?: number;
  /** An encounter just beaten: its group stays gone for the session. */
  defeated?: string;
}

/**
 * Exploration on one map at a time: draws the map, moves the hero along A*
 * paths (diagonals allowed), previews paths on hover and changes map when the
 * hero walks off an edge that has a neighbour. Monster groups stand on the
 * map; clicking one walks up to it and starts the fight.
 */
export class MapScene extends Phaser.Scene {
  private byCoord = new Map<string, GameMap>();
  private byId = new Map<string, GameMap>();
  private map!: GameMap;
  private mapObjects: Phaser.GameObjects.GameObject[] = [];
  private occluders: Occluder[] = [];
  /** Monster groups standing on this map, by cell. */
  private groupAt = new Map<number, Encounter>();
  private groupSprites: Phaser.GameObjects.Image[] = [];
  private pendingFight: Encounter | null = null;

  private player!: Phaser.GameObjects.Image;
  private playerCell = 0;
  /** Cell the hero is currently stepping into, or -1 when standing still. */
  private stepTarget = -1;
  private queue: number[] = [];
  private moving = false;
  private pendingExit: Edge | null = null;
  private view: 'front' | 'back' = 'front';
  private walkFrame = 0;
  private walkTimer?: Phaser.Time.TimerEvent;

  private overlay!: Phaser.GameObjects.Graphics;
  private debugGfx!: Phaser.GameObjects.Graphics;
  private debugLabels: Phaser.GameObjects.Text[] = [];
  private hoverCell = -1;
  private showDebug = false;
  private showRange = false;
  private transitioning = false;

  constructor() {
    super('map');
  }

  create(data: MapSceneData) {
    // Phaser reuses the scene object when a fight hands back: start from a clean slate.
    this.mapObjects = [];
    this.occluders = [];
    this.groupAt = new Map();
    this.groupSprites = [];
    this.pendingFight = null;
    this.queue = [];
    this.moving = false;
    this.stepTarget = -1;
    this.pendingExit = null;
    this.debugLabels = [];
    this.hoverCell = -1;
    this.transitioning = false;
    const defeated = new Set<string>(this.registry.get(DEFEATED) ?? []);
    if (data.defeated) defeated.add(data.defeated);
    this.registry.set(DEFEATED, [...defeated]);
    hud.showExplore(true);

    for (const m of world.maps) {
      this.byCoord.set(mapKey(m.worldX, m.worldY), m);
      this.byId.set(m.id, m);
    }
    const first = this.byId.get(data.mapId) ?? world.maps[0];
    if (!first) throw new Error('no maps in world.json; run npm run maps:build');

    this.overlay = this.add.graphics().setDepth(DEPTH.overlay);
    this.debugGfx = this.add.graphics().setDepth(DEPTH.debug);

    const hero = sprite('hero_front_0');
    this.player = this.add.image(0, 0, 'hero_front_0').setOrigin(hero.anchorX / hero.width, hero.anchorY / hero.height);

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.setHover(this.cellAt(p)));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const cell = this.cellAt(p);
      this.setHover(cell);
      if (cell !== -1) this.walkTo(cell);
    });
    this.input.on('gameout', () => this.setHover(-1));
    this.input.keyboard?.on('keydown-D', () => this.toggleDebug());
    this.input.keyboard?.on('keydown-R', () => this.toggleRange());
    hud.onToggle('btn-debug', () => this.toggleDebug());
    hud.onToggle('btn-range', () => this.toggleRange());
    bar.on({ select: (id) => this.selectHero(id), slot: (spellId) => windows.showSpell(spellId) });
    windows.onSelect((id) => this.selectHero(id));
    bar.hint('Click a tile to walk · click the monsters to fight · the amber edge leads on · S spells, C characteristics');
    this.renderParty();

    this.loadMap(first, data.cell !== undefined && isWalkable(first, data.cell) ? data.cell : this.startCell(first));
    this.cameras.main.fadeIn(300, 15, 26, 20);
  }

  override update() {
    updateOccluders(this.occluders, [this.player, ...this.groupSprites]);
  }

  // ------------------------------------------------------------------ map

  private startCell(map: GameMap): number {
    // A road cell a quarter of the way across, so the hero starts on the path.
    const road = map.tiles.indexOf('path');
    let best = -1;
    let bestScore = Infinity;
    for (let c = 0; c < CELL_COUNT; c++) {
      if (!isWalkable(map, c) || (road !== -1 && map.ground[c] !== road)) continue;
      const score = Math.abs(cellToScreen(c).sx - 300);
      if (score < bestScore) {
        best = c;
        bestScore = score;
      }
    }
    return best === -1 ? 0 : best;
  }

  private loadMap(map: GameMap, cell: number) {
    for (const o of this.mapObjects) o.destroy();
    this.map = map;
    const drawn = drawMap(this, map);
    this.mapObjects = drawn.objects;
    this.occluders = drawn.occluders;
    this.placeGroups();

    this.tweens.killTweensOf(this.player);
    this.queue = [];
    this.stepTarget = -1;
    this.pendingExit = null;
    this.stopWalking();
    this.placePlayer(cell);
    hud.setMap(map.name, REGION_NAME, map.worldX, map.worldY);
    bar.log(`You are in ${map.name}.`, 'system');
    this.redrawOverlay();
    this.drawDebug();
  }

  private neighbourAcross(edge: Edge): GameMap | undefined {
    const { dx, dy } = EDGE_OFFSET[edge];
    return this.byCoord.get(mapKey(this.map.worldX + dx, this.map.worldY + dy));
  }

  /** The edge a cell leads out through, if the map has a neighbour on that side. */
  private exitEdge(cell: number): Edge | null {
    if (!isWalkable(this.map, cell)) return null;
    for (const edge of cellEdges(cell)) if (this.neighbourAcross(edge)) return edge;
    return null;
  }

  private changeMap(edge: Edge) {
    const next = this.neighbourAcross(edge);
    if (!next) return;
    this.transitioning = true;
    this.setHover(-1);
    const here = cellToScreen(this.playerCell);
    const horizontal = edge === 'east' || edge === 'west';
    const candidates = edgeCells(next, OPPOSITE_EDGE[edge]);
    const hereGround = this.map.tiles[this.map.ground[this.playerCell]!];
    let arrival = candidates[0] ?? this.startCell(next);
    let bestGap = Infinity;
    for (const c of candidates) {
      const s = cellToScreen(c);
      // Closest cell along the shared edge; on a tie, stay on the same ground (road to road).
      const sameGround = next.tiles[next.ground[c]!] === hereGround;
      const gap = (horizontal ? Math.abs(s.sy - here.sy) : Math.abs(s.sx - here.sx)) - (sameGround ? 1 : 0);
      if (gap < bestGap) {
        bestGap = gap;
        arrival = c;
      }
    }
    const cam = this.cameras.main;
    cam.fadeOut(180, 15, 26, 20);
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.loadMap(next, arrival);
      cam.fadeIn(220, 15, 26, 20);
      this.transitioning = false;
      // The pointer may already rest over the new map: refresh the preview and readout.
      const p = this.input.activePointer;
      this.hoverCell = -2;
      this.setHover(p.active || p.wasTouch ? -1 : this.cellAt(p));
    });
  }

  // ------------------------------------------------------------------ movement

  /** The party on the bar and in the windows: full health while exploring. */
  private renderParty() {
    const party = partySetups().map(viewOfSetup);
    const selected = (this.registry.get(SELECTED_HERO) as string | undefined) ?? party[0]?.id ?? '';
    bar.render({ party, selected, focus: party.find((h) => h.id === selected) ?? null, aiming: null, mode: 'explore' });
    windows.update(party, selected);
  }

  private selectHero(id: string) {
    this.registry.set(SELECTED_HERO, id);
    this.renderParty();
  }

  /** Monsters stand on their group's cells, so those are not walkable while exploring. */
  private walkable = (c: number) => isWalkable(this.map, c) && !this.groupAt.has(c);

  /** Draws the monster groups of this map that are still around. */
  private placeGroups() {
    this.groupAt = new Map();
    this.groupSprites = [];
    const defeated = new Set<string>(this.registry.get(DEFEATED) ?? []);
    for (const e of ENCOUNTERS) {
      if (e.mapId !== this.map.id || defeated.has(e.id)) continue;
      e.monsters.forEach((m, i) => {
        const cell = e.cells[i % e.cells.length]!;
        const img = placeSprite(this, textureOf(monsterLook(m.id), 'front', 0), cell);
        img.setFlipX(true); // face the road, towards the west
        this.mapObjects.push(img);
        this.groupSprites.push(img);
        this.groupAt.set(cell, e);
      });
    }
  }

  private describeGroup(e: Encounter): string {
    const counts = new Map<string, number>();
    for (const m of e.monsters) {
      const name = monsters.find((x) => x.id === m.id)?.name ?? m.id;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const levels = e.monsters.reduce((sum, m) => sum + (monsters.find((x) => x.id === m.id)?.grades[m.grade - 1]?.level ?? 0), 0);
    const names = [...counts].map(([name, n]) => (n > 1 ? `${n} × ${name}` : name)).join(', ');
    return `${names} (total level ${levels}) · click to fight`;
  }

  /** Walks next to a monster group and starts the fight on arrival. */
  private engage(e: Encounter) {
    const start = this.stepTarget !== -1 ? this.stepTarget : this.playerCell;
    if (e.cells.some((c) => neighbors(start, true).includes(c))) {
      this.startFight(e);
      return;
    }
    let best: number[] | null = null;
    for (const c of e.cells) {
      const path = findPath(start, c, this.walkable, { diagonals: true, allowGoalBlocked: true });
      path?.pop();
      if (path && (!best || path.length < best.length)) best = path;
    }
    if (!best) {
      this.pulse(e.cells[0]!, COLORS.blocked);
      return;
    }
    this.pulse(e.cells[0]!, COLORS.fight);
    this.pendingExit = null;
    this.pendingFight = e;
    this.queue = best;
    if (this.moving) return;
    if (best.length === 0) {
      this.startFight(e);
      return;
    }
    this.startWalking();
    this.nextStep();
  }

  private startFight(e: Encounter) {
    this.pendingFight = null;
    this.transitioning = true;
    this.setHover(-1);
    const cam = this.cameras.main;
    cam.flash(160, 242, 165, 65);
    cam.fadeOut(260, 15, 26, 20);
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      const data: FightSceneData = { mapId: this.map.id, encounterId: e.id, returnCell: this.playerCell };
      this.scene.start('fight', data);
    });
  }

  /** Path from where the hero is (or is stepping into) to a cell; stops beside obstacles. */
  private pathTo(target: number): number[] | null {
    const start = this.stepTarget !== -1 ? this.stepTarget : this.playerCell;
    if (target === start) return [];
    if (this.walkable(target)) return findPath(start, target, this.walkable, { diagonals: true });
    const path = findPath(start, target, this.walkable, { diagonals: true, allowGoalBlocked: true });
    path?.pop();
    return path;
  }

  private walkTo(cell: number) {
    if (this.transitioning) return;
    const group = this.groupAt.get(cell);
    if (group) {
      this.engage(group);
      return;
    }
    this.pendingFight = null;
    const path = this.pathTo(cell);
    if (path === null) {
      this.pulse(cell, COLORS.blocked);
      return;
    }
    this.pulse(cell, COLORS.target);
    this.pendingExit = this.exitEdge(cell);
    this.queue = path;
    if (this.moving) return; // the current step finishes, then the new queue takes over
    if (path.length === 0) {
      if (this.pendingExit && this.exitEdge(this.playerCell) === this.pendingExit) this.changeMap(this.pendingExit);
      return;
    }
    this.startWalking();
    this.nextStep();
  }

  private nextStep() {
    const next = this.queue.shift();
    if (next === undefined) {
      this.arrive();
      return;
    }
    const from = this.player;
    const to = cellPos(next);
    this.stepTarget = next;
    this.face(directionBetween(this.playerCell, next));
    const duration = (Math.hypot(to.x - from.x, to.y - from.y) / WALK_SPEED) * 1000;
    this.tweens.add({
      targets: this.player,
      x: to.x,
      y: to.y,
      duration,
      ease: 'Linear',
      onUpdate: () => this.player.setDepth(DEPTH.sorted + this.player.y),
      onComplete: () => {
        this.playerCell = next;
        this.stepTarget = -1;
        this.nextStep();
        this.redrawOverlay();
      },
    });
  }

  private arrive() {
    this.stopWalking();
    if (this.pendingFight) {
      this.startFight(this.pendingFight);
      return;
    }
    const exit = this.pendingExit;
    this.pendingExit = null;
    if (exit && this.exitEdge(this.playerCell) === exit) this.changeMap(exit);
  }

  private placePlayer(cell: number) {
    const { x, y } = cellPos(cell);
    this.playerCell = cell;
    this.player.setPosition(x, y).setDepth(DEPTH.sorted + y);
  }

  private face(dir: Direction) {
    this.view = dir === Direction.North || dir === Direction.NorthEast || dir === Direction.NorthWest ? 'back' : 'front';
    this.player.setFlipX(dir === Direction.SouthWest || dir === Direction.West || dir === Direction.NorthWest);
    this.player.setTexture(`hero_${this.view}_${this.walkFrame}`);
  }

  private startWalking() {
    this.moving = true;
    this.walkTimer?.remove();
    this.walkTimer = this.time.addEvent({
      delay: 150,
      loop: true,
      callback: () => {
        this.walkFrame ^= 1;
        this.player.setTexture(`hero_${this.view}_${this.walkFrame}`);
      },
    });
  }

  private stopWalking() {
    this.moving = false;
    this.walkTimer?.remove();
    this.walkTimer = undefined;
    this.walkFrame = 0;
    this.player?.setTexture(`hero_${this.view}_0`);
  }

  // ------------------------------------------------------------------ overlays

  private cellAt(p: Phaser.Input.Pointer): number {
    return screenToCell(p.worldX - ORIGIN_X, p.worldY - ORIGIN_Y);
  }

  private setHover(cell: number) {
    if (cell === this.hoverCell) return;
    this.hoverCell = cell;
    this.redrawOverlay();
    this.updateReadout();
  }

  private redrawOverlay() {
    const g = this.overlay;
    g.clear();

    // Exits glow faintly so players can see where the map continues.
    for (const edge of Object.keys(EDGE_OFFSET) as Edge[]) {
      if (!this.neighbourAcross(edge)) continue;
      g.fillStyle(COLORS.exit, 0.22);
      for (const c of edgeCells(this.map, edge)) {
        const { x, y } = cellPos(c);
        g.fillPoints(diamond(x, y, 1), true);
      }
    }

    if (this.showRange && !this.moving) {
      const reach = reachableCells(this.playerCell, PREVIEW_MP, this.walkable);
      for (const c of reach.keys()) {
        const { x, y } = cellPos(c);
        g.fillStyle(COLORS.range, 0.3);
        g.fillPoints(diamond(x, y, 1), true);
        g.lineStyle(1.5, COLORS.range, 0.85);
        g.strokePoints(diamond(x, y, 1), true);
      }
    }

    const cell = this.hoverCell;
    if (cell === -1 || this.transitioning) return;
    const group = this.groupAt.get(cell);
    if (group) {
      for (const c of group.cells) {
        const p = cellPos(c);
        g.lineStyle(2, COLORS.fight, 0.95).strokePoints(diamond(p.x, p.y, 2), true);
      }
      return;
    }
    const path = this.pathTo(cell);
    const { x, y } = cellPos(cell);
    if (path === null) {
      g.lineStyle(2, COLORS.blocked, 0.9);
      g.strokePoints(diamond(x, y, 2), true);
      return;
    }
    g.fillStyle(COLORS.path, 0.9);
    for (const c of path.slice(0, -1)) {
      const p = cellPos(c);
      g.fillCircle(p.x, p.y, 3.5);
    }
    const end = path.at(-1);
    if (end !== undefined && end !== cell) {
      // Clicking an obstacle walks next to it: mark where the hero will stop.
      const p = cellPos(end);
      g.fillCircle(p.x, p.y, 3.5);
    }
    g.fillStyle(COLORS.target, 0.16);
    g.fillPoints(diamond(x, y, 2), true);
    g.lineStyle(2, COLORS.target, 0.95);
    g.strokePoints(diamond(x, y, 2), true);

    const exit = this.exitEdge(cell);
    if (exit) {
      const v = EDGE_VECTOR[exit];
      const px = -v.y;
      const py = v.x;
      g.fillStyle(COLORS.exit, 1);
      g.fillTriangle(
        x + v.x * 13,
        y + v.y * 9,
        x - v.x * 3 + px * 8,
        y - v.y * 2 + py * 6,
        x - v.x * 3 - px * 8,
        y - v.y * 2 - py * 6,
      );
    }
  }

  private pulse(cell: number, color: number) {
    const { x, y } = cellPos(cell);
    const ring = this.add.ellipse(x, y, HALF_W * 1.2, HALF_H * 1.2).setStrokeStyle(2, color, 1).setDepth(DEPTH.overlay + 1);
    this.tweens.add({
      targets: ring,
      scaleX: 1.6,
      scaleY: 1.6,
      alpha: 0,
      duration: 380,
      ease: 'Quad.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  private updateReadout() {
    const c = this.hoverCell;
    if (c === -1) {
      hud.setCell(null);
      return;
    }
    const { x, y } = cellToGrid(c);
    const objIndex = this.map.objects[c]!;
    const objKey = objIndex >= 0 ? this.map.tiles[objIndex]! : null;
    const groundKey = this.map.tiles[this.map.ground[c]!]!;
    let status: string;
    const group = this.groupAt.get(c);
    if (group) status = 'Monster group';
    else if (this.walkable(c)) status = 'Walkable';
    else if (objKey) status = `Blocked by ${OBJECT_LABELS[objKey] ?? objKey}`;
    else if (groundKey === 'water') status = 'Water';
    else status = 'Blocked';
    if (blocksLineOfSight(this.map, c)) status += ' · blocks sight';
    const exit = this.exitEdge(c);
    hud.setCell({
      cell: c,
      x,
      y,
      status,
      ...(exit ? { exit: `Exit ${exit} to ${this.neighbourAcross(exit)!.name}` } : {}),
      ...(group ? { group: this.describeGroup(group) } : {}),
    });
  }

  private toggleDebug() {
    this.showDebug = !this.showDebug;
    hud.setToggle('btn-debug', this.showDebug);
    this.drawDebug();
  }

  private toggleRange() {
    this.showRange = !this.showRange;
    hud.setToggle('btn-range', this.showRange);
    this.redrawOverlay();
  }

  /** Cell grid, ids and flags: unwalkable cells in red, sight blockers outlined dark. */
  private drawDebug() {
    const g = this.debugGfx;
    g.clear();
    for (const t of this.debugLabels) t.destroy();
    this.debugLabels = [];
    if (!this.showDebug) return;
    for (let c = 0; c < CELL_COUNT; c++) {
      const { x, y } = cellPos(c);
      if (!this.walkable(c)) {
        g.fillStyle(COLORS.debugBlocked, 0.32);
        g.fillPoints(diamond(x, y), true);
      }
      if (blocksLineOfSight(this.map, c)) {
        g.lineStyle(2.5, COLORS.debugSight, 0.8);
        g.strokePoints(diamond(x, y, 3), true);
      }
      g.lineStyle(1, COLORS.debugGrid, 0.22);
      g.strokePoints(diamond(x, y), true);
      this.debugLabels.push(
        this.add
          .text(x, y, String(c), { fontFamily: '"IBM Plex Mono", ui-monospace, monospace', fontSize: '10px', color: '#fffaf0' })
          .setOrigin(0.5)
          .setAlpha(0.8)
          .setDepth(DEPTH.debug + 1),
      );
    }
  }
}
