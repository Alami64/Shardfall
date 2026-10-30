import Phaser from 'phaser';
import {
  Direction,
  PLACEMENT_SECONDS,
  TURN_SECONDS,
  activeFighter,
  castError,
  castSpell,
  castableCells,
  createFight,
  createRng,
  directionBetween,
  endTurn,
  fighterAt,
  flee,
  getFighter,
  moveFighter,
  movePath,
  movementRange,
  placeFighter,
  playAiTurn,
  screenToCell,
  shieldOf,
  spellAreaCells,
  spellError,
  spellRangeCells,
  startFight,
  type FightEvent,
  type FightResult,
  type FightState,
  type Fighter,
  type Rng,
} from '@shardfall/shared';
import { spells, sprite, world } from '../assets';
import { DEPTH, ORIGIN_X, ORIGIN_Y, REGION_NAME } from '../config';
import { buffLabel, describeEvent, errorText, spellName } from '../fight/describe';
import { fightHud, type FighterCard } from '../fight/fightHud';
import { ENCOUNTERS, encounterSetups, lookOf, partySetups, textureOf, type Encounter, type Look } from '../fight/setup';
import { hud } from '../hud';
import { cellPos, diamond, drawMap, placeSprite, updateOccluders, type Occluder } from '../render/mapView';
import { bar, type BarMode } from '../ui/bar';
import { viewOfFighter, type CharacterView } from '../ui/characters';
import { windows } from '../ui/windows';

export interface FightSceneData {
  mapId: string;
  encounterId: string;
  /** Where the explorer stood; exploration resumes there. */
  returnCell: number;
}

const COLORS = {
  teamA: 0x5aa9e6,
  teamB: 0xe0533d,
  move: 0xc8f76a,
  range: 0x3fc1b0,
  area: 0xf2a541,
  invalid: 0xe0533d,
  path: 0xfff6dc,
  active: 0xf2a541,
} as const;

/** Step and slide speeds, in ms per cell. */
const WALK_MS = 150;
const SLIDE_MS = 90;

interface Unit {
  look: Look;
  img: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Ellipse;
  bar: Phaser.GameObjects.Graphics;
  view: 'front' | 'back';
  hp: number;
  floats: number;
}

/** Registry key: the hero picked in the party list, shared with exploration. */
export const SELECTED_HERO = 'selectedHero';

const teamColor = (f: Fighter) => (f.team === 'A' ? COLORS.teamA : COLORS.teamB);

/**
 * A fight on the exploration map: placement, then turns until one side is
 * out. The rules all live in @shardfall/shared; this scene draws the state,
 * turns clicks and keys into fight actions, lets the AI play the monsters and
 * animates the events every action returns.
 */
export class FightScene extends Phaser.Scene {
  private params!: FightSceneData;
  private encounter!: Encounter;
  private state!: FightState;
  private rng!: Rng;
  private units = new Map<string, Unit>();
  private occluders: Occluder[] = [];
  private overlay!: Phaser.GameObjects.Graphics;

  private hover = -1;
  private selectedSpell: string | null = null;
  /** The hero being placed during placement. */
  private placing = '';
  /** Whose turn the HUD shows; follows turnStarted events while they animate. */
  private shownActive = '';
  /** True while events animate or the AI plays: input waits. */
  private busy = false;
  private countdown = 0;
  private countdownFor = '';
  private idleFrame = 0;
  /** Dev aid: the AI plays the heroes too (window.shardfall.auto()). */
  private autoPlay = false;

  constructor() {
    super('fight');
  }

  create(data: FightSceneData) {
    this.params = data;
    this.units = new Map();
    this.hover = -1;
    this.selectedSpell = null;
    this.busy = false;
    this.countdownFor = '';
    this.autoPlay = false;

    const map = world.maps.find((m) => m.id === data.mapId);
    const encounter = ENCOUNTERS.find((e) => e.id === data.encounterId);
    if (!map || !encounter) throw new Error(`no fight for ${data.mapId} / ${data.encounterId}`);
    this.encounter = encounter;

    // Offline fights roll their own dice; ?seed=N in the URL replays the same fight,
    // and ?speed=N plays animations and timers N times faster (for automated runs).
    const params = new URLSearchParams(window.location.search);
    const seedParam = Number(params.get('seed'));
    const seed = Number.isInteger(seedParam) && seedParam > 0 ? seedParam : Date.now() >>> 0;
    this.rng = createRng(seed);
    const speed = Number(params.get('speed'));
    const timeScale = speed > 0 ? speed : 1;
    this.time.timeScale = timeScale;
    this.tweens.timeScale = timeScale;

    this.occluders = drawMap(this, map).occluders;
    this.overlay = this.add.graphics().setDepth(DEPTH.overlay);

    const created = createFight(map, [...partySetups(), ...encounterSetups(encounter)], this.rng, { spells });
    if (!created.ok) throw new Error(`cannot start the fight: ${created.error}`);
    this.state = created.state;
    for (const f of this.state.fighters) this.addUnit(f);
    this.placing = this.heroes()[0]?.id ?? '';

    hud.setMap(map.name, REGION_NAME, map.worldX, map.worldY);
    hud.showExplore(false);
    fightHud.show(true);
    bar.clearLog();
    bar.log(`A monster group attacks! (fight seed ${seed})`, 'turn');
    this.wireInput();

    if (import.meta.env.DEV) {
      // For the run-shardfall driver and the console: the live fight, and whether input is open.
      (window as unknown as { shardfall: object }).shardfall = {
        fight: () => this.state,
        busy: () => this.busy,
        auto: () => {
          this.autoPlay = true;
          if (!this.busy) this.continueFight();
        },
      };
    }
    this.time.addEvent({ delay: 450, loop: true, callback: () => this.animateIdle() });
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.tick() });
    this.startCountdown('placement', PLACEMENT_SECONDS);
    this.refresh();
    this.cameras.main.fadeIn(250, 15, 26, 20);
  }

  override update() {
    updateOccluders(this.occluders, [...this.units.values()].map((u) => u.img));
  }

  // ------------------------------------------------------------------ input

  private wireInput() {
    bar.onButton('btn-ready', () => this.ready());
    bar.onButton('btn-end-turn', () => this.playerAction((id) => endTurn(this.state, id)));
    bar.onButton('btn-flee', () => this.playerAction((id) => flee(this.state, id)));
    fightHud.onResult(() => this.leave());
    bar.on({ select: (id) => this.selectHero(id), slot: (spellId) => this.clickSlot(spellId) });
    windows.onSelect((id) => this.selectHero(id));

    this.input.mouse?.disableContextMenu();
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.setHover(this.cellAt(p)));
    this.input.on('gameout', () => this.setHover(-1));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) {
        this.cancelSpell();
        return;
      }
      const cell = this.cellAt(p);
      this.setHover(cell);
      if (cell !== -1) this.clickCell(cell);
    });
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.cancelSpell();
      else if (e.key === 'Enter' && this.state.phase === 'placement') this.ready();
      else if (e.key === ' ' && this.canAct()) this.playerAction((id) => endTurn(this.state, id));
      else if (/^[1-9]$/.test(e.key)) {
        const slot = this.active()?.spells[Number(e.key) - 1];
        if (slot) this.toggleSpell(slot.spellId);
      }
    });
  }

  private cellAt(p: Phaser.Input.Pointer): number {
    return screenToCell(p.worldX - ORIGIN_X, p.worldY - ORIGIN_Y);
  }

  private clickCell(cell: number) {
    if (this.state.phase === 'placement') {
      const there = fighterAt(this.state, cell);
      if (there && there.controller === 'player') {
        this.placing = there.id;
        this.refresh();
        return;
      }
      if (!this.state.startCells.A.includes(cell)) return;
      this.apply(placeFighter(this.state, this.placing, cell));
      return;
    }
    if (!this.canAct()) return;
    const spellId = this.selectedSpell;
    if (spellId) {
      const error = castError(this.state, this.active()!.id, spellId, cell);
      if (error) {
        bar.toast(errorText(error));
        return;
      }
      this.selectedSpell = null;
      this.playerAction((id) => castSpell(this.state, id, spellId, cell, this.rng));
      return;
    }
    const me = this.active()!;
    if (cell === me.cell || fighterAt(this.state, cell)) return;
    const path = movePath(this.state, me.id, cell);
    if (!path) {
      bar.toast(me.mp > 0 ? 'Out of reach' : 'No MP left');
      return;
    }
    this.playerAction((id) => moveFighter(this.state, id, path));
  }

  /** A party button or a window tab: during placement, the hero to place; later, whose windows show. */
  private selectHero(id: string) {
    if (!this.heroes().some((h) => h.id === id)) return;
    this.registry.set(SELECTED_HERO, id);
    if (this.state.phase === 'placement') this.placing = id;
    this.refresh();
  }

  /** A spell slot: aims the spell on the hero's own turn, otherwise opens its description. */
  private clickSlot(spellId: string) {
    if (this.canAct() && this.active()!.spells.some((s) => s.spellId === spellId)) this.toggleSpell(spellId);
    else windows.showSpell(spellId);
  }

  private toggleSpell(spellId: string) {
    if (!this.canAct()) return;
    if (this.selectedSpell === spellId) {
      this.cancelSpell();
      return;
    }
    const error = spellError(this.state, this.active()!.id, spellId);
    if (error) {
      bar.toast(errorText(error));
      return;
    }
    this.selectedSpell = spellId;
    this.refresh();
  }

  private cancelSpell() {
    if (this.selectedSpell === null) return;
    this.selectedSpell = null;
    this.refresh();
  }

  private setHover(cell: number) {
    if (cell === this.hover) return;
    this.hover = cell;
    this.refresh();
  }

  // ------------------------------------------------------------------ flow

  private heroes = () => this.state.fighters.filter((f) => f.controller === 'player');
  private active = () => activeFighter(this.state);
  private canAct = () => !this.busy && this.state.phase === 'fighting' && this.active()?.controller === 'player';

  private ready() {
    if (this.state.phase !== 'placement' || this.busy) return;
    this.apply(startFight(this.state, this.rng));
  }

  /** Runs an action for the hero whose turn it is. */
  private playerAction(action: (fighterId: string) => FightResult) {
    if (!this.canAct()) return;
    this.apply(action(this.active()!.id));
  }

  /** Takes an action's result: shows the error, or adopts the new state and plays its events. */
  private apply(result: FightResult) {
    if (!result.ok) {
      bar.toast(errorText(result.error));
      return;
    }
    this.state = result.state;
    this.busy = true;
    this.refresh();
    void this.play(result.events).then(() => {
      this.busy = false;
      this.sync();
      this.continueFight();
    });
  }

  /** After the events: end the fight, let the AI play, or hand the turn to the player. */
  private continueFight() {
    if (this.state.phase === 'ended') {
      this.showEnd();
      return;
    }
    if (this.state.phase !== 'fighting') {
      this.refresh();
      return;
    }
    const a = this.active()!;
    this.shownActive = a.id;
    if (a.controller === 'ai' || this.autoPlay) {
      this.busy = true;
      this.refresh();
      this.time.delayedCall(350, () => this.apply(playAiTurn(this.state, a.id, this.rng)));
      return;
    }
    this.startCountdown(`${a.id}:${a.turns}`, TURN_SECONDS);
    this.refresh();
  }

  private startCountdown(key: string, seconds: number) {
    if (this.countdownFor === key) return;
    this.countdownFor = key;
    this.countdown = seconds;
    fightHud.setTimer(seconds);
  }

  /** Once a second: the placement or turn clock runs while the player can act. */
  private tick() {
    const placement = this.state.phase === 'placement';
    if (this.busy || (!placement && !this.canAct())) return;
    this.countdown--;
    fightHud.setTimer(Math.max(0, this.countdown));
    if (this.countdown > 0) return;
    if (placement) this.ready();
    else {
      bar.toast('Time is up');
      this.selectedSpell = null;
      this.playerAction((id) => endTurn(this.state, id));
    }
  }

  private showEnd() {
    fightHud.setTimer(null);
    this.refresh();
    const won = this.state.winner === 'A';
    const standing = this.heroes().filter((h) => h.status === 'alive').length;
    fightHud.showResult(
      won ? 'Victory' : 'Defeat',
      won
        ? `The meadow is quiet again. ${standing} of ${this.heroes().length} heroes still standing after ${this.state.round} rounds.`
        : 'Your party falls back to the road to recover.',
    );
  }

  private leave() {
    fightHud.show(false);
    hud.showExplore(true);
    const won = this.state.winner === 'A';
    this.cameras.main.fadeOut(200, 15, 26, 20);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('map', {
        mapId: this.params.mapId,
        cell: this.params.returnCell,
        ...(won ? { defeated: this.encounter.id } : {}),
      });
    });
  }

  // ------------------------------------------------------------------ drawing

  private addUnit(f: Fighter) {
    const look = lookOf(f.id);
    const img = placeSprite(this, textureOf(look, 'front', 0), f.cell);
    const { x, y } = cellPos(f.cell);
    const ring = this.add
      .ellipse(x, y, 54, 26)
      .setStrokeStyle(2.5, teamColor(f), 0.95)
      .setFillStyle(teamColor(f), 0.18)
      .setDepth(DEPTH.overlay + 1);
    const bar = this.add.graphics().setDepth(DEPTH.debug - 10);
    const unit: Unit = { look, img, ring, bar, view: 'front', hp: f.hp, floats: 0 };
    this.units.set(f.id, unit);
    // Face the other side to start with.
    this.face(unit, f.team === 'A' ? Direction.East : Direction.West);
    this.drawBar(f.id);
  }

  private face(unit: Unit, dir: Direction) {
    const away = dir === Direction.North || dir === Direction.NorthEast || dir === Direction.NorthWest;
    unit.view = unit.look.hasBack && away ? 'back' : 'front';
    unit.img.setFlipX(dir === Direction.SouthWest || dir === Direction.West || dir === Direction.NorthWest);
    unit.img.setTexture(textureOf(unit.look, unit.view, this.idleFrame));
  }

  private animateIdle() {
    this.idleFrame ^= 1;
    for (const u of this.units.values()) u.img.setTexture(textureOf(u.look, u.view, this.idleFrame));
  }

  private place(id: string, cell: number) {
    const u = this.units.get(id)!;
    const { x, y } = cellPos(cell);
    u.img.setPosition(x, y).setDepth(DEPTH.sorted + y);
    u.ring.setPosition(x, y);
    this.drawBar(id);
  }

  /** A small HP bar above the unit's head. */
  private drawBar(id: string) {
    const u = this.units.get(id)!;
    const f = getFighter(this.state, id)!;
    const info = sprite(textureOf(u.look, 'front', 0));
    const w = 40;
    const x = u.img.x - w / 2;
    const y = u.img.y - info.anchorY - 8;
    const g = u.bar;
    g.clear();
    if (!u.img.visible) return;
    g.fillStyle(0x0f1a14, 0.8).fillRect(x - 1, y - 1, w + 2, 7);
    g.fillStyle(teamColor(f), 1).fillRect(x, y, Math.max(0, (w * u.hp) / f.stats.maxHp), 5);
    const shield = shieldOf(f);
    if (shield > 0) g.fillStyle(0xe8f4ff, 0.9).fillRect(x, y - 3, Math.min(w, (w * shield) / f.stats.maxHp), 2);
  }

  /** Snaps every unit to the state: position, visibility, HP, active ring. */
  private sync() {
    for (const f of this.state.fighters) {
      const u = this.units.get(f.id)!;
      const alive = f.status === 'alive';
      u.img.setVisible(alive).setAlpha(1);
      u.ring.setVisible(alive);
      u.hp = f.hp;
      if (alive) this.place(f.id, f.cell);
      else u.bar.clear();
    }
    this.refresh();
  }

  private floatText(id: string, text: string, color: string) {
    const u = this.units.get(id);
    if (!u) return;
    const info = sprite(textureOf(u.look, 'front', 0));
    const offset = u.floats++ * 16;
    const label = this.add
      .text(u.img.x, u.img.y - info.anchorY - 18 - offset, text, {
        fontFamily: '"Alegreya Sans", system-ui, sans-serif',
        fontSize: '17px',
        fontStyle: 'bold',
        color,
        stroke: '#0f1a14',
        strokeThickness: 4,
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.debug);
    this.tweens.add({
      targets: label,
      y: label.y - 26,
      alpha: 0,
      delay: 500,
      duration: 650,
      onComplete: () => {
        label.destroy();
        u.floats = Math.max(0, u.floats - 1);
      },
    });
  }

  private flashCell(cell: number, color: number) {
    const { x, y } = cellPos(cell);
    const g = this.add.graphics().setDepth(DEPTH.overlay + 2);
    g.fillStyle(color, 0.55).fillPoints(diamond(x, y, 2), true);
    this.tweens.add({ targets: g, alpha: 0, duration: 450, onComplete: () => g.destroy() });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }

  private tween(config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return new Promise((resolve) => this.tweens.add({ ...config, onComplete: () => resolve() }));
  }

  /** Walks a unit cell by cell (moves) or slides it (pushes and pulls). */
  private async travel(id: string, path: number[], msPerCell: number, turn: boolean) {
    const u = this.units.get(id)!;
    let from = screenToCell(u.img.x - ORIGIN_X, u.img.y - ORIGIN_Y);
    for (const cell of path) {
      if (turn) this.face(u, directionBetween(from, cell));
      const { x, y } = cellPos(cell);
      await this.tween({
        targets: [u.img, u.ring],
        x,
        y,
        duration: msPerCell,
        onUpdate: () => {
          u.img.setDepth(DEPTH.sorted + u.img.y);
          this.drawBar(id);
        },
      });
      from = cell;
    }
  }

  /** Plays the events of one action, in order, then the board is synced to the state. */
  private async play(events: FightEvent[]) {
    for (const e of events) {
      const words = describeEvent(e, this.state);
      if (words.log) bar.log(words.log.line, words.log.kind);
      if (words.float) this.floatText(words.float.fighterId, words.float.text, words.float.color);
      await this.animate(e);
    }
  }

  private async animate(e: FightEvent) {
    switch (e.type) {
      case 'placed':
        this.place(e.fighterId, e.cell);
        return;
      case 'turnStarted':
        this.shownActive = e.fighterId;
        this.selectedSpell = null;
        this.refresh();
        await this.wait(250);
        return;
      case 'moved':
        await this.travel(e.fighterId, e.path, WALK_MS, true);
        return;
      case 'displaced': {
        const u = this.units.get(e.fighterId)!;
        if (e.reason === 'push' || e.reason === 'pull') {
          await this.travel(e.fighterId, e.path, SLIDE_MS, false);
          return;
        }
        await this.tween({ targets: u.img, alpha: 0, duration: 120 });
        this.place(e.fighterId, e.path.at(-1)!);
        await this.tween({ targets: u.img, alpha: 1, duration: 160 });
        return;
      }
      case 'spellCast': {
        const u = this.units.get(e.fighterId)!;
        const from = getFighter(this.state, e.fighterId)?.cell ?? -1;
        if (from !== -1 && e.cell !== from) this.face(u, directionBetween(screenToCell(u.img.x - ORIGIN_X, u.img.y - ORIGIN_Y), e.cell));
        const area = spellAreaCells(this.state, e.fighterId, e.spellId, e.cell);
        for (const c of area.length ? area : [e.cell]) this.flashCell(c, COLORS.area);
        await this.wait(320);
        return;
      }
      case 'damaged': {
        const u = this.units.get(e.fighterId)!;
        u.hp = e.hp;
        this.drawBar(e.fighterId);
        u.img.setTintFill(0xffffff);
        await this.wait(90);
        u.img.clearTint();
        await this.wait(140);
        return;
      }
      case 'healed': {
        this.units.get(e.fighterId)!.hp = e.hp;
        this.drawBar(e.fighterId);
        await this.wait(200);
        return;
      }
      case 'died':
      case 'fled': {
        const u = this.units.get(e.fighterId)!;
        u.bar.clear();
        u.ring.setVisible(false);
        await this.tween({ targets: u.img, alpha: 0, duration: 380 });
        u.img.setVisible(false);
        return;
      }
      case 'revived': {
        const u = this.units.get(e.fighterId)!;
        u.hp = e.hp;
        u.img.setVisible(true).setAlpha(0);
        u.ring.setVisible(true);
        this.place(e.fighterId, e.cell);
        await this.tween({ targets: u.img, alpha: 1, duration: 300 });
        return;
      }
      case 'shieldHit':
      case 'buffAdded':
      case 'pointsRemoved':
      case 'pointsChanged':
      case 'tackled':
        this.drawBar(e.fighterId);
        await this.wait(160);
        return;
      case 'fightEnded':
        await this.wait(500);
        return;
      default:
        return;
    }
  }

  // ------------------------------------------------------------------ HUD and previews

  private refresh() {
    const s = this.state;
    const placement = s.phase === 'placement';
    const fighting = s.phase === 'fighting';
    const shown = getFighter(s, placement ? this.placing : this.shownActive || (this.active()?.id ?? ''));

    fightHud.setRound(placement ? 'Placement' : s.phase === 'ended' ? 'Fight over' : `Round ${s.round}`);
    const order = placement ? s.fighters.map((f) => f.id) : s.turnOrder;
    fightHud.setTimeline(
      order.map((id) => {
        const f = getFighter(s, id)!;
        const hp = this.units.get(id)?.hp ?? f.hp;
        return { id, name: f.name, team: f.team, hp, maxHp: f.stats.maxHp, alive: f.status === 'alive', active: id === shown?.id };
      }),
    );

    const hovered = this.hover !== -1 ? fighterAt(s, this.hover) : undefined;
    fightHud.setHover(hovered ? this.card(hovered) : null);

    const mine = fighting && !this.busy && shown?.controller === 'player' && shown.id === this.active()?.id;
    const mode: BarMode = placement ? 'placement' : s.phase === 'ended' ? 'ended' : mine ? 'player' : 'waiting';
    const party = this.heroes().map((h) => this.view(h, mine));
    const selected = placement ? this.placing : (this.registry.get(SELECTED_HERO) as string | undefined) ?? party[0]?.id ?? '';
    // The orb and the slots follow the hero whose turn it is; otherwise the one picked.
    const focusId = fighting && shown?.controller === 'player' ? shown.id : selected;
    bar.render({ party, selected, focus: party.find((h) => h.id === focusId) ?? null, aiming: this.selectedSpell, mode });
    windows.update(party, selected);
    if (s.phase === 'ended') fightHud.setTimer(null);
    bar.hint(this.hint(mine, shown));

    for (const f of s.fighters) {
      const u = this.units.get(f.id)!;
      const isActive = fighting && f.id === shown?.id;
      u.ring.setStrokeStyle(isActive ? 3.5 : 2.5, isActive ? COLORS.active : teamColor(f), 0.95);
    }
    this.drawOverlay(mine);
  }

  /** A hero for the bar and the windows, with its HP as currently drawn (it lags the state while hits animate). */
  private view(f: Fighter, mine: boolean): CharacterView {
    const myTurn = mine && f.id === this.active()?.id;
    const v = viewOfFighter(this.state, f, (spellId) => {
      if (!myTurn) return 'Not this hero’s turn';
      const error = spellError(this.state, f.id, spellId);
      return error ? errorText(error) : null;
    });
    return { ...v, hp: this.units.get(f.id)?.hp ?? v.hp };
  }

  private card(f: Fighter): FighterCard {
    const notes = [...new Set(f.buffs.map(buffLabel))];
    return {
      name: f.name,
      team: f.team,
      hp: this.units.get(f.id)?.hp ?? f.hp,
      maxHp: f.stats.maxHp,
      ap: f.ap,
      mp: f.mp,
      notes,
    };
  }

  private hint(mine: boolean, shown: Fighter | undefined): string {
    if (this.state.phase === 'placement') {
      const name = getFighter(this.state, this.placing)?.name ?? '';
      return `Placing ${name}: click a blue cell (or pick another hero below) · Ready when set`;
    }
    if (this.state.phase === 'ended') return '';
    if (!mine) return shown ? `${shown.name} is playing…` : '';
    if (this.selectedSpell) return `${spellName(this.selectedSpell)}: click a highlighted cell · Esc or right-click to cancel`;
    return 'Click a green cell to move · pick a spell (1–6) to act · Space ends the turn · S spells, C characteristics';
  }

  private fill(cell: number, color: number, alpha: number, stroke = 0) {
    const { x, y } = cellPos(cell);
    const g = this.overlay;
    g.fillStyle(color, alpha).fillPoints(diamond(x, y, 1), true);
    if (stroke) g.lineStyle(1.5, color, stroke).strokePoints(diamond(x, y, 1), true);
  }

  private drawOverlay(mine: boolean) {
    const g = this.overlay;
    g.clear();
    const s = this.state;
    if (s.phase === 'placement') {
      for (const c of s.startCells.A) this.fill(c, COLORS.teamA, c === this.hover ? 0.55 : 0.3, 0.8);
      for (const c of s.startCells.B) this.fill(c, COLORS.teamB, 0.22, 0.6);
      return;
    }
    if (!mine) return;
    const me = this.active()!;
    if (this.selectedSpell) {
      const castable = new Set(castableCells(s, me.id, this.selectedSpell));
      for (const c of spellRangeCells(s, me.id, this.selectedSpell)) {
        this.fill(c, COLORS.range, castable.has(c) ? 0.4 : 0.16, castable.has(c) ? 0.9 : 0.35);
      }
      if (castable.has(this.hover)) {
        for (const c of spellAreaCells(s, me.id, this.selectedSpell, this.hover)) this.fill(c, COLORS.area, 0.5, 0.95);
      } else if (this.hover !== -1) {
        const { x, y } = cellPos(this.hover);
        g.lineStyle(2, COLORS.invalid, 0.9).strokePoints(diamond(x, y, 2), true);
      }
      return;
    }
    for (const c of movementRange(s, me.id).keys()) this.fill(c, COLORS.move, 0.34, 0.85);
    if (this.hover === -1 || fighterAt(s, this.hover)) return;
    const path = movePath(s, me.id, this.hover);
    if (!path || path.length === 0) return;
    g.fillStyle(COLORS.path, 0.95);
    for (const c of path.slice(0, -1)) {
      const p = cellPos(c);
      g.fillCircle(p.x, p.y, 3.5);
    }
    const { x, y } = cellPos(this.hover);
    g.lineStyle(2, COLORS.path, 0.95).strokePoints(diamond(x, y, 2), true);
  }
}
