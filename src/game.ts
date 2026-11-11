// The controller: input, exploring, fight flow, rewards, NPCs, saving.
import {
  ELEMENT_COLOR, ITEMS, MAP_BY_ID, MONSTERS, monsterXp, QUESTS, xpNeed, type MapDef,
} from './core/content.js';
import {
  addItem, buyItem, derived, equipItem, gainXp, newCharacter, playerFighter, raiseSpell, raiseStat, sellItem, unequip, useItem,
  weaponSpell, WEAPON_SPELL, type Character, type HeroLook, type ItemInst,
} from './core/character.js';
import {
  aiTurn, cast, castError, createFight, current, endTurn, move, moveCells, spellArea, spellCells, spellOf, startFight,
  type FEvent, type Fighter,
} from './core/fight.js';
import { center, colOf, COLS, dist, neighbors, pickCell, rowOf, ROWS, VIEW_H, VIEW_W } from './core/grid.js';
import { findPath, reachable } from './core/path.js';
import { createRng, pick, rint } from './core/rng.js';
import {
  arrivalCell, buildMap, fightCells, monsterFighter, nearestWalkable, neighborMap, populate,
  type Dir, type GameMap, type Group, type Npc,
} from './core/world.js';
import { actorAt, burst, floatText, placeActor, portrait, projectile, render, setMap, updateActors } from './render/view.js';
import { G, type Actor } from './state.js';
import {
  actions, banner, barSpells, clearLog, closeWindow, fade, fighterHtml, groupHtml, hideTip, initHud, log, openWindow, refresh,
  refreshBar, refreshTimeline, setMapInfo, showTip, toggleWindow, windowOpen,
} from './ui/hud.js';

const SAVE_KEY = 'shardfall-save-v1';
const rng = createRng((Date.now() ^ 0x9e3779b9) >>> 0);
const maps: Record<string, GameMap> = {};
let cv: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let busy = false;
let speed = 1;
let autoPlay = false;
let targetGroup: Group | null = null;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms / speed));

// ------------------------------------------------------------ saving

function save() {
  if (!G.ready) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, ch: G.ch })); } catch { /* storage may be unavailable */ }
}
function load(): Character | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.v !== 1 || !data.ch?.name || !MAP_BY_ID[data.ch.mapId]) return null;
    return data.ch as Character;
  } catch { return null; }
}

// ------------------------------------------------------------ actors

function baseActor(key: string, kind: Actor['kind'], name: string, cell: number): Actor {
  const p = center(cell);
  return { key, kind, name, scale: 1, x: p.x, y: p.y, cell, facing: 1, walking: false, path: [], speed: 170, alpha: 1, flashUntil: 0 };
}
function heroActor(cell: number): Actor {
  const a = baseActor('hero', 'hero', G.ch.name, cell);
  a.look = G.ch.look;
  a.armed = true;
  a.onStep = (c) => { if (G.mode === 'explore') G.ch.cell = c; };
  return a;
}
function npcActor(n: Npc): Actor {
  const a = baseActor('npc-' + n.id, 'npc', n.name, n.cell);
  a.look = n.look;
  a.npc = n;
  a.elder = n.id === 'tobin';
  a.facing = -1;
  return a;
}
function groupActor(g: Group): Actor {
  const d = MONSTERS[g.members[0]!.def]!;
  const a = baseActor('group-' + g.id, 'monster', d.name, g.cell);
  a.shape = d.shape; a.colors = d.colors; a.scale = d.scale; a.group = g; a.speed = 60;
  a.facing = rng() < 0.5 ? 1 : -1;
  a.wanderAt = G.now + 1500 + rng() * 6000;
  return a;
}
function fighterActor(f: Fighter): Actor {
  const a = baseActor('f-' + f.id, f.kind === 'player' ? 'hero' : 'monster', f.name, f.cell);
  a.fighterId = f.id; a.team = f.team; a.hp = f.hp; a.maxHp = f.maxHp; a.speed = 210;
  if (f.kind === 'player') { a.look = G.ch.look; a.armed = true; }
  else { const d = MONSTERS[f.kind]!; a.shape = d.shape; a.colors = d.colors; a.scale = d.scale; a.facing = -1; }
  return a;
}

function rebuildExploreActors() {
  const map = G.map;
  G.hero = heroActor(G.ch.cell);
  G.actors = [G.hero, ...map.npcs.map(npcActor), ...map.groups.map(groupActor)];
}

// ------------------------------------------------------------ maps

const getMap = (id: string) => (maps[id] ??= buildMap(MAP_BY_ID[id]!));

function enterMap(id: string, cell: number) {
  const map = getMap(id);
  G.map = map;
  if (cell < 0 || !map.walkable[cell]) cell = nearestWalkable(map, cell < 0 ? map.spawn : cell);
  populate(map, rng, cell, performance.now());
  G.ch.mapId = id;
  G.ch.cell = cell;
  G.marks = [];
  targetGroup = null;
  setMap(map);
  rebuildExploreActors();
  setMapInfo();
  save();
}

async function changeMap(dir: Dir, fromCell: number) {
  const next = neighborMap(G.map.def, dir) as MapDef | undefined;
  if (!next || busy) return;
  busy = true;
  fade(true);
  await sleep(190);
  enterMap(next.id, arrivalCell(getMap(next.id), fromCell, dir));
  G.hero.facing = dir === 'left' ? -1 : 1;
  fade(false);
  banner(next.name);
  refresh();
  busy = false;
}

// ------------------------------------------------------------ exploring

function walk(isGoal: (i: number) => boolean, then: () => void): boolean {
  const hero = G.hero;
  const start = hero.path.length ? hero.path[0]! : hero.cell;
  const p = findPath(start, isGoal, (i) => !!G.map.walkable[i], true);
  if (!p) return false;
  hero.path = hero.path.length ? [hero.path[0]!, ...p] : p;
  hero.onArrive = then;
  if (!hero.path.length) { hero.onArrive = undefined; then(); }
  return true;
}
const walkNear = (cell: number, then: () => void) => walk((i) => i !== cell && dist(i, cell) <= 1, then);

function engage(group: Group, tries = 0) {
  if (G.mode !== 'explore' || !G.map.groups.includes(group)) return;
  if (dist(G.hero.cell, group.cell) <= 2 || tries > 3) beginFight(group);
  else walkNear(group.cell, () => engage(group, tries + 1));
}

function exploreClick(px: number, py: number) {
  if (busy || windowOpen()) return;
  const a = actorAt(px, py);
  if (a?.group) { targetGroup = a.group; walkNear(a.group.cell, () => engage(a.group!)); return; }
  if (a?.npc) { targetGroup = null; walkNear(a.npc.cell, () => talk(a.npc!)); return; }
  const cell = pickCell(px, py);
  if (cell < 0 || !G.map.walkable[cell]) return;
  targetGroup = null;
  walk((i) => i === cell, () => {
    const dir = G.map.exits[cell];
    if (dir) void changeMap(dir, cell);
    else save();
  });
}

let secondAcc = 0;
function exploreTick(dt: number, t: number) {
  const map = G.map;
  for (const a of G.actors) {
    if (!a.group || a.group === targetGroup || a.path.length || t < (a.wanderAt ?? 0)) continue;
    a.wanderAt = t + 3000 + rng() * 7000;
    const opts = neighbors(a.cell).filter((c) =>
      map.walkable[c] && !map.exits[c] && rowOf(c) > 3 && rowOf(c) < ROWS - 4 && colOf(c) > 0 && colOf(c) < COLS - 1 &&
      c !== G.hero.cell && !map.groups.some((g) => g.cell === c));
    if (opts.length && rng() < 0.75) { const c = pick(rng, opts); a.group.cell = c; a.path = [c]; }
  }
  secondAcc += dt;
  if (secondAcc < 1) return;
  secondAcc = 0;
  const ch = G.ch, max = derived(ch).maxHp;
  if (ch.hp < max) { ch.hp = Math.min(max, ch.hp + Math.max(1, Math.round(max / 60))); refreshBar(); }
  for (const g of populate(map, rng, G.hero.cell, t)) G.actors.push(groupActor(g));
}

// ------------------------------------------------------------ NPCs

function questDialog() {
  const ch = G.ch, q = QUESTS[ch.quest];
  const npc = G.map.npcs.find((n) => n.role === 'quest')!;
  const img = portrait({ kind: 'npc', look: npc.look, elder: true });
  const reward = (qq: typeof q) => qq ? `<div class="isub" style="margin-top:6px">Reward: ${qq.xp} XP, <span class="gold">${qq.gold} g</span>${qq.item ? ', ' + ITEMS[qq.item]!.name : ''}</div>` : '';
  let text: string, buttons: { label: string; act: string; go?: boolean }[];
  if (!q) { text = 'The Hollow is quiet at last. Emberhollow will remember you, Runeblade.'; buttons = [{ label: 'Farewell', act: 'bye' }]; }
  else if (!ch.questTaken) { text = `<b>${q.name}</b><br>${q.text}<br>Defeat ${q.count} × ${MONSTERS[q.target]!.name}.${reward(q)}`; buttons = [{ label: 'Later', act: 'bye' }, { label: 'Accept', act: 'accept', go: true }]; }
  else if (ch.questProg < q.count) { text = `<b>${q.name}</b><br>You are not done yet: ${ch.questProg} of ${q.count} ${MONSTERS[q.target]!.name}s. ${q.text}`; buttons = [{ label: 'On my way', act: 'bye' }]; }
  else { text = `<b>${q.name}</b><br>Good work. You have earned this.${reward(q)}`; buttons = [{ label: 'Claim reward', act: 'claim', go: true }]; }
  openWindow('dialog', { name: npc.name, title: npc.title, text, buttons, img });
}

function talk(npc: Npc) {
  if (G.mode !== 'explore') return;
  G.hero.facing = center(npc.cell).x >= G.hero.x ? 1 : -1;
  if (npc.role === 'shop') { G.shop = true; openWindow('bag'); G.shop = true; }
  else if (npc.role === 'heal') {
    openWindow('dialog', {
      name: npc.name, title: npc.title, img: portrait({ kind: 'npc', look: npc.look }),
      text: 'Sit by the hearth a moment. The road will still be there when you stand.',
      buttons: [{ label: 'Not now', act: 'bye' }, { label: 'Rest (full health)', act: 'rest', go: true }],
    });
  } else questDialog();
}

// ------------------------------------------------------------ fights

function beginFight(group: Group) {
  if (G.mode === 'fight') return;
  const map = G.map, ch = G.ch;
  const cells = fightCells(map, group, G.hero.cell, rng);
  const members = group.members.slice(0, cells.monsters.length);
  const fighters = [
    playerFighter(ch, cells.player[0]!),
    ...members.map((m, i) => monsterFighter(m.def, m.level, cells.monsters[i]!)),
  ];
  const st = createFight(fighters, map.walkable.slice(), map.opaque, { [WEAPON_SPELL]: weaponSpell(ch) });
  G.mode = 'fight';
  G.fight = { st, phase: 'placement', startCells: cells.player, group, selected: null, turnId: -1, auto: autoPlay };
  G.actors = fighters.map(fighterActor);
  G.hero = G.actors[0]!;
  G.hero.facing = center(group.cell).x >= G.hero.x ? 1 : -1;
  targetGroup = null;
  closeWindow();
  hideTip();
  clearLog();
  banner('Choose your starting cell', 1800);
  log('Pick a highlighted cell, then press Ready.', 'a');
  updateMarks();
  refresh();
  if (autoPlay) void ready();
}

const hero = () => G.fight!.st.fighters[0]!;
const actorOf = (id: number) => G.actors.find((a) => a.fighterId === id)!;

function updateMarks() {
  const f = G.fight;
  G.marks = [];
  if (!f) return;
  const st = f.st, me = hero();
  if (f.phase === 'placement') {
    for (const c of f.startCells) G.marks.push({ cell: c, fill: c === me.cell ? 'rgba(255,120,90,.8)' : 'rgba(255,120,90,.36)' });
    for (const o of st.fighters) if (o.team === 1) G.marks.push({ cell: o.cell, fill: 'rgba(90,160,255,.32)' });
    return;
  }
  if (f.phase !== 'player') return;
  if (f.selected) {
    const { ok, blocked } = spellCells(st, me, f.selected);
    for (const c of blocked) G.marks.push({ cell: c, fill: 'rgba(90,150,255,.24)' });
    for (const c of ok) G.marks.push({ cell: c, fill: 'rgba(90,150,255,.42)' });
    if (G.hover >= 0 && ok.includes(G.hover)) {
      for (const c of spellArea(spellOf(st, f.selected), G.hover)) G.marks.push({ cell: c, fill: 'rgba(255,90,60,.62)', stroke: 'rgba(255,220,200,.9)' });
    }
    return;
  }
  const other = st.fighters.find((o) => o.alive && o.team === 1 && o.cell === G.hover);
  if (other) {
    for (const c of reachable(other.cell, other.mp || other.baseMp, (i) => !!st.walkable[i] && !st.fighters.some((x) => x.alive && x.cell === i)).keys()) {
      G.marks.push({ cell: c, fill: 'rgba(200,120,255,.28)' });
    }
    return;
  }
  const reach = moveCells(st, me);
  for (const c of reach.keys()) G.marks.push({ cell: c, fill: 'rgba(95,208,138,.30)' });
  const path = reach.get(G.hover);
  if (path) for (const c of path) G.marks.push({ cell: c, fill: 'rgba(95,208,138,.78)' });
}

async function play(evs: FEvent[]) {
  const f = G.fight;
  if (!f) return;
  for (const e of evs) {
    switch (e.t) {
      case 'turn':
        f.turnId = e.id;
        refreshTimeline();
        break;
      case 'move': {
        const a = actorOf(e.id);
        await new Promise<void>((res) => { a.path = [...e.path]; a.onArrive = res; });
        break;
      }
      case 'cast': {
        const a = actorOf(e.id);
        const to = center(e.cell);
        const dx = to.x - a.x, dy = to.y - a.y, d = Math.hypot(dx, dy);
        if (Math.abs(dx) > 1) a.facing = dx > 0 ? 1 : -1;
        log(`${a.name.split(',')[0]} casts ${e.name}${e.crit ? ': critical hit!' : '.'}`, a.team === 0 ? 'a' : 'd');
        if (d < 1) { burst(a.x, a.y, e.color); await sleep(200); }
        else if (d < 80) { a.lunge = { dx: dx / d, dy: dy / d, t0: G.now }; await sleep(130); burst(to.x, to.y, e.color, 300); await sleep(70); }
        else {
          const dur = Math.min(420, 150 + d * 0.6) / speed;
          projectile(a.x, a.y - 24, to.x, to.y - 16, e.color, dur);
          await sleep(dur * speed);
          burst(to.x, to.y, e.color);
        }
        if (e.cells.length > 1) for (const c of e.cells) if (c !== e.cell) { const p = center(c); burst(p.x, p.y, e.color, 320); }
        break;
      }
      case 'dmg': {
        const a = actorOf(e.id);
        a.hp = e.hp;
        a.flashUntil = G.now + 260;
        floatText(a.x, a.y - 44 * (a.scale - 1), `-${e.n}`, ELEMENT_COLOR[e.el], e.crit ? 23 : 17);
        log(`${a.name.split(',')[0]} loses ${e.n} HP.`, a.team === 0 ? 'r' : '');
        refreshBar();
        refreshTimeline();
        await sleep(240);
        break;
      }
      case 'heal': {
        const a = actorOf(e.id);
        a.hp = e.hp;
        floatText(a.x, a.y - 44 * (a.scale - 1), `+${e.n}`, '#7dff9a');
        burst(a.x, a.y, '#7dff9a', 300);
        log(`${a.name.split(',')[0]} recovers ${e.n} HP.`, 'g');
        refreshBar();
        refreshTimeline();
        await sleep(220);
        break;
      }
      case 'death': {
        const a = actorOf(e.id);
        a.hp = 0;
        log(`${a.name.split(',')[0]} is defeated.`, a.team === 0 ? 'r' : 'g');
        for (let k = 1; k <= 8; k++) { a.alpha = 1 - k / 8; await sleep(35); }
        refreshTimeline();
        break;
      }
      case 'buff': {
        const a = actorOf(e.id);
        floatText(a.x, a.y - 44 * (a.scale - 1), e.text, e.good ? '#ffd166' : '#ff9a8a', 13);
        await sleep(110);
        break;
      }
      case 'slide': {
        const a = actorOf(e.id);
        const keep = a.speed;
        a.speed = 420;
        await new Promise<void>((res) => { a.path = [e.to]; a.onArrive = res; });
        a.speed = keep;
        break;
      }
      case 'tp': {
        const a = actorOf(e.id);
        burst(a.x, a.y, '#c9a6ff');
        placeActor(a, e.to);
        burst(a.x, a.y, '#c9a6ff');
        await sleep(200);
        break;
      }
      case 'log': log(e.text, 'd'); break;
      case 'end': break;
    }
  }
}

async function ready() {
  const f = G.fight;
  if (!f || f.phase !== 'placement') return;
  f.phase = 'busy';
  updateMarks();
  await play(startFight(f.st));
  await runTurns();
}

async function runTurns() {
  const f = G.fight;
  if (!f) return;
  const st = f.st;
  while (!st.over) {
    const cur = current(st);
    f.turnId = cur.id;
    if (cur.team === 0 && !f.auto) {
      f.phase = 'player';
      banner('Your turn', 700);
      updateMarks();
      refresh();
      return;
    }
    f.phase = cur.team === 0 ? 'busy' : 'enemy';
    f.selected = null;
    updateMarks();
    refresh();
    await sleep(260);
    await play(aiTurn(st, cur, rng));
    if (st.over) break;
    await sleep(140);
    await play(endTurn(st));
  }
  finishFight();
}

async function afterAction() {
  const f = G.fight!;
  if (f.st.over) { finishFight(); return; }
  f.phase = 'player';
  if (f.selected && castError(f.st, hero(), f.selected, -1) !== 'Out of the map') f.selected = null;
  updateMarks();
  refresh();
}

async function doCast(spell: string, cell: number) {
  const f = G.fight!;
  f.phase = 'busy';
  G.marks = [];
  const ev = cast(f.st, hero(), spell, cell, rng);
  refreshBar();
  await play(ev);
  await afterAction();
}

async function doMove(path: number[]) {
  const f = G.fight!;
  f.phase = 'busy';
  G.marks = [];
  const ev = move(f.st, hero(), path, rng);
  refreshBar();
  await play(ev);
  await afterAction();
}

async function endPlayerTurn() {
  const f = G.fight;
  if (!f || f.phase !== 'player') return;
  f.phase = 'busy';
  f.selected = null;
  G.marks = [];
  refresh();
  await play(endTurn(f.st));
  await runTurns();
}

function fightCell(px: number, py: number): number {
  const a = actorAt(px, py);
  const f = G.fight!;
  if (a && a.fighterId !== undefined && f.st.fighters[a.fighterId]!.alive) return a.cell;
  return pickCell(px, py);
}

function fightClick(px: number, py: number) {
  const f = G.fight;
  if (!f || windowOpen()) return;
  const st = f.st, me = hero();
  if (f.phase === 'placement') {
    const cell = pickCell(px, py);
    if (f.startCells.includes(cell)) { me.cell = cell; placeActor(G.hero, cell); updateMarks(); }
    return;
  }
  if (f.phase !== 'player') return;
  const cell = fightCell(px, py);
  if (cell < 0) return;
  if (f.selected) {
    const err = castError(st, me, f.selected, cell);
    if (!err) void doCast(f.selected, cell);
    else { log(err + '.', 'r'); if (err === 'Out of range') { f.selected = null; updateMarks(); refreshBar(); } }
    return;
  }
  const path = moveCells(st, me).get(cell);
  if (path) void doMove(path);
}

function selectSpell(id: string | null) {
  const f = G.fight;
  if (!f || f.phase !== 'player') return;
  if (id && id !== f.selected) {
    const err = castError(f.st, hero(), id, -1);
    if (err !== 'Out of the map') { log((err ?? 'Cannot cast') + '.', 'r'); return; }
    f.selected = id;
  } else f.selected = null;
  updateMarks();
  refreshBar();
}

function finishFight() {
  const f = G.fight;
  if (!f || f.phase === 'over') return;
  f.phase = 'over';
  G.marks = [];
  const st = f.st, me = hero(), ch = G.ch, map = G.map;
  if (st.over === 'win') {
    const foes = st.fighters.filter((x) => x.team === 1);
    const luck = derived(ch).luck;
    let xp = 0, gold = 0;
    const items: ItemInst[] = [];
    for (const m of foes) {
      const d = MONSTERS[m.kind]!;
      xp += monsterXp(d, m.level);
      gold += Math.round(rint(rng, d.gold[0], d.gold[1]) * (1 + m.level / 2));
      for (const dr of d.drops) {
        if (rng() >= dr.p * (1 + luck / 100)) continue;
        const inst = addItem(ch, dr.item, 1, rng);
        const shown = items.find((i) => i.def === dr.item && !inst.stats);
        if (shown) shown.qty++; else items.push({ ...inst, qty: 1 });
      }
    }
    xp = Math.round(xp * (1 + 0.15 * (foes.length - 1)));
    let quest: string | undefined;
    const q = QUESTS[ch.quest];
    if (q && ch.questTaken && ch.questProg < q.count) {
      const kills = foes.filter((m) => m.kind === q.target).length;
      if (kills) {
        ch.questProg = Math.min(q.count, ch.questProg + kills);
        quest = ch.questProg >= q.count ? `Quest complete: ${q.name}. Return to Old Tobin.` : `${q.name}: ${ch.questProg} / ${q.count}`;
      }
    }
    ch.hp = Math.max(1, me.hp);
    ch.gold += gold;
    ch.wins++;
    ch.cell = me.cell;
    const levels = gainXp(ch, xp);
    const gi = map.groups.indexOf(f.group);
    if (gi >= 0) map.groups.splice(gi, 1);
    if (f.group.boss) map.bossAt = performance.now() + 180000;
    else map.respawns.push(performance.now() + 40000);
    openWindow('result', { win: true, xp, gold, items, levels, quest });
  } else {
    ch.hp = Math.max(1, Math.ceil(derived(ch).maxHp * 0.3));
    openWindow('result', { win: false });
  }
  save();
  refresh();
  if (autoPlay) setTimeout(closeWindow, 50);
}

function closeResult() {
  const f = G.fight;
  if (!f) return;
  const lost = f.st.over !== 'win';
  G.fight = null;
  G.mode = 'explore';
  G.marks = [];
  clearLog();
  if (lost) { enterMap('village', -1); banner('Emberhollow'); }
  else rebuildExploreActors();
  refreshTimeline();
  refresh();
  save();
}

// ------------------------------------------------------------ input

function toCanvas(ev: MouseEvent): [number, number] {
  const r = cv.getBoundingClientRect();
  return [((ev.clientX - r.left) * VIEW_W) / r.width, ((ev.clientY - r.top) * VIEW_H) / r.height];
}

function onMove(ev: MouseEvent) {
  const [px, py] = toCanvas(ev);
  const a = actorAt(px, py);
  const before = G.hover;
  if (G.mode === 'fight') {
    G.hover = fightCell(px, py);
    const f = G.fight!;
    if (a && a.fighterId !== undefined && f.st.fighters[a.fighterId]!.alive) showTip(fighterHtml(f.st.fighters[a.fighterId]!), ev.clientX, ev.clientY);
    else hideTip();
    if (G.hover !== before) updateMarks();
    cv.style.cursor = 'default';
    return;
  }
  G.hover = pickCell(px, py);
  if (a?.group) showTip(groupHtml(a.group.members), ev.clientX, ev.clientY);
  else if (a?.npc) showTip(`<div class="iname">${a.npc.name}</div><div class="isub">${a.npc.title}</div>`, ev.clientX, ev.clientY);
  else hideTip();
  const exit = G.hover >= 0 && G.map.exits[G.hover];
  cv.style.cursor = a?.group || a?.npc || exit ? 'pointer' : 'default';
  if (exit) {
    const next = neighborMap(G.map.def, exit);
    if (next && !a) showTip(`<div class="iname">To ${next.name}</div><div class="isub">${next.levels ? `Monsters level ${next.levels[0]}–${next.boss ? 25 : next.levels[1]}` : 'Safe'}</div>`, ev.clientX, ev.clientY);
  }
}

function onKey(ev: KeyboardEvent) {
  if ((ev.target as HTMLElement).tagName === 'INPUT') return;
  const k = ev.key.toLowerCase();
  if (k === 'escape') {
    if (windowOpen()) closeWindow();
    else if (G.fight?.selected) selectSpell(null);
    return;
  }
  if (!G.ready) return;
  if (k === 'c') toggleWindow('char');
  else if (k === 'i' || k === 'b') toggleWindow('bag');
  else if (k === 's') toggleWindow('spells');
  else if (k === 'm') toggleWindow('map');
  else if (G.fight && !windowOpen()) {
    const idx = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'].indexOf(ev.key);
    const s = idx >= 0 ? barSpells()[idx] : undefined;
    if (s) selectSpell(s.def.id);
    if (k === ' ' || k === 'enter') { ev.preventDefault(); actions.act(); }
  }
}

// ------------------------------------------------------------ boot

function wireActions() {
  actions.selectSpell = selectSpell;
  actions.act = () => {
    const f = G.fight;
    if (!f) return;
    if (f.phase === 'placement') void ready();
    else if (f.phase === 'player') void endPlayerTurn();
  };
  const outOfFight = () => {
    if (G.mode === 'fight') { log('Not during a fight.', 'r'); return false; }
    return true;
  };
  actions.equip = (uid) => { if (!outOfFight()) return; const err = equipItem(G.ch, uid); if (err) log(err + '.', 'r'); save(); };
  actions.unequip = (slot) => { if (!outOfFight()) return; unequip(G.ch, slot); save(); };
  actions.use = (uid) => { if (!outOfFight()) return; const err = useItem(G.ch, uid); if (err) log(err + '.', 'r'); save(); };
  actions.sell = (uid) => { const g = sellItem(G.ch, uid); if (g) log(`Sold for ${g} g.`, 'a'); save(); };
  actions.buy = (def) => { const err = buyItem(G.ch, def, rng); log(err ? err + '.' : `Bought ${ITEMS[def]!.name}.`, err ? 'r' : 'a'); save(); };
  actions.raiseStat = (k, n) => { raiseStat(G.ch, k, n); save(); refresh(); };
  actions.raiseSpell = (id) => { raiseSpell(G.ch, id); save(); refresh(); };
  actions.closeResult = closeResult;
  actions.create = (name: string, look: HeroLook) => {
    G.ch = newCharacter(name, look);
    addItem(G.ch, 'bread', 3, rng);
    G.ready = true;
    enterMap('village', -1);
    refresh();
    banner('Emberhollow', 1800);
    log(`Welcome, ${name}. Speak to Old Tobin by the waystone.`, 'a');
    log('Click the ground to walk. Click a monster to fight.', 'd');
  };
  actions.reset = () => {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    G.ready = false;
    G.fight = null;
    G.mode = 'explore';
    G.ch = newCharacter('', { tunic: '#3f7fbf', hair: '#5a3a22', skin: '#f0c9a4' });
    enterMap('village', -1);
    openWindow('create');
  };
  actions.npc = (what) => {
    const ch = G.ch;
    if (what === 'rest') {
      ch.hp = derived(ch).maxHp;
      log('You feel rested.', 'g');
      closeWindow();
    } else if (what === 'accept') {
      ch.questTaken = true;
      ch.questProg = 0;
      log(`Quest accepted: ${QUESTS[ch.quest]!.name}.`, 'a');
      closeWindow();
    } else if (what === 'claim') {
      const q = QUESTS[ch.quest]!;
      const levels = gainXp(ch, q.xp);
      ch.gold += q.gold;
      if (q.item) addItem(ch, q.item, 1, rng);
      log(`Quest reward: ${q.xp} XP, ${q.gold} g${q.item ? ', ' + ITEMS[q.item]!.name : ''}.`, 'a');
      if (levels) { log(`Level up! You are level ${ch.level}.`, 'g'); banner(`Level ${ch.level}!`); }
      ch.quest++;
      ch.questTaken = false;
      ch.questProg = 0;
      questDialog();
    } else closeWindow();
    save();
    refresh();
  };
}

export function boot() {
  cv = document.getElementById('cv') as HTMLCanvasElement;
  ctx = cv.getContext('2d')!;
  initHud();
  wireActions();
  cv.addEventListener('mousemove', onMove);
  cv.addEventListener('mouseleave', () => { G.hover = -1; hideTip(); if (G.fight) updateMarks(); });
  cv.addEventListener('click', (ev) => {
    const [px, py] = toCanvas(ev);
    if (G.mode === 'fight') { G.hover = fightCell(px, py); fightClick(px, py); }
    else if (G.ready) exploreClick(px, py);
  });
  cv.addEventListener('contextmenu', (ev) => { ev.preventDefault(); selectSpell(null); });
  window.addEventListener('keydown', onKey);

  const saved = load();
  if (saved) {
    G.ch = saved;
    G.ready = true;
    enterMap(saved.mapId, saved.cell);
    log(`Welcome back, ${saved.name}.`, 'a');
  } else {
    G.ch = newCharacter('', { tunic: '#3f7fbf', hair: '#5a3a22', skin: '#f0c9a4' });
    enterMap('village', -1);
    openWindow('create');
  }
  refresh();

  let last = performance.now();
  const frame = (t: number) => {
    const dt = Math.min(0.05, (t - last) / 1000) * speed;
    last = t;
    G.now = t;
    if (G.mode === 'explore' && G.ready) exploreTick(dt, t);
    updateActors(dt);
    render(ctx, t);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Hooks for testing from the browser console or a driver script.
  (window as any).shardfall = {
    G,
    busy: () => busy || (!!G.fight && G.fight.phase !== 'player' && G.fight.phase !== 'placement'),
    speed: (n: number) => { speed = n; },
    auto: (on: boolean) => {
      autoPlay = on;
      const f = G.fight;
      if (f) { f.auto = on; if (on && f.phase === 'placement') void ready(); else if (on && f.phase === 'player') void runTurns(); }
    },
    level: (n: number) => { while (G.ch.level < n) gainXp(G.ch, xpNeed(G.ch.level) - G.ch.xp); refresh(); save(); },
    give: (def: string, qty = 1) => { const it = addItem(G.ch, def, qty, rng); refresh(); save(); return it.uid; },
    gold: (n: number) => { G.ch.gold += n; refresh(); },
    goto: (id: string) => { enterMap(id, -1); refresh(); },
    fight: (i = 0) => { const g = G.map.groups[i]; if (g) beginFight(g); },
    cellXY: (c: number, dy = 0) => {
      const p = center(c), r = cv.getBoundingClientRect();
      return [r.left + (p.x * r.width) / VIEW_W, r.top + ((p.y + dy) * r.height) / VIEW_H];
    },
    talk: (id: string) => { const n = G.map.npcs.find((x) => x.id === id); if (n) talk(n); },
  };
}
