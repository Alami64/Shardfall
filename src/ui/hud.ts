// DOM interface: bottom bar, timeline, log, tooltips and windows.
import {
  ELEMENT_COLOR, ELEMENT_NAME, ITEMS, LEVEL_CAP, MAPS, MAX_RANK, MONSTERS, PLAYER_SPELLS, QUESTS, rankCost, sellPrice, SETS,
  SHOP_STOCK, STAT_LABEL, STAT_ORDER, xpNeed, type ItemDef, type SpellDef, type StatKey,
} from '../core/content.js';
import {
  BASE_STATS, derived, gmOf, isGear, knownSpells, playerFighter, rankOf, setCounts, SLOT_LABEL, SLOTS, totals, weaponSpell, WEAPON_SPELL,
  type BaseStat, type HeroLook, type ItemInst, type Slot,
} from '../core/character.js';
import { castError, current, damageRange, healRange, powerOf, spellOf, type Fighter } from '../core/fight.js';
import { icon, ITEM_ICON } from '../render/icons.js';
import { monsterPortrait, portrait } from '../render/view.js';
import { G } from '../state.js';
import { gm, gmItemList, gmWindow } from './gm.js';

export interface Actions {
  selectSpell(id: string | null): void;
  act(): void;
  equip(uid: number): void;
  unequip(slot: Slot): void;
  use(uid: number): void;
  sell(uid: number): void;
  buy(def: string): void;
  raiseStat(k: BaseStat, n: number): void;
  raiseSpell(id: string): void;
  resetStats(): void;
  /** GM tools: op names the change, args carries its values. */
  gm(op: string, args?: Record<string, string | number | boolean>): void;
  setBody(body: 'sprout' | 'classic'): void;
  resetSpells(): void;
  closeResult(): void;
  create(name: string, look: HeroLook): void;
  npc(what: string): void;
  reset(): void;
}
export const actions = {} as Actions;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

// ------------------------------------------------------------ tooltips

const tips = new Map<string, string>();
let tipSeq = 0;
function tipAttr(html: string): string {
  if (tips.size > 600) tips.clear();
  const k = 't' + tipSeq++;
  tips.set(k, html);
  return `data-tip="${k}"`;
}
export function showTip(html: string, x: number, y: number) {
  const el = $('tip');
  el.innerHTML = html;
  el.style.display = 'block';
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(4, Math.min(window.innerWidth - r.width - 4, x + 14)) + 'px';
  el.style.top = Math.max(4, Math.min(window.innerHeight - r.height - 4, y - r.height - 10 < 4 ? y + 18 : y - r.height - 10)) + 'px';
}
export function hideTip() { $('tip').style.display = 'none'; }

// ------------------------------------------------------------ text helpers

function statLine(k: StatKey, v: number, range?: [number, number]): string {
  const pct = k === 'crit' || k.startsWith('res');
  const label = pct ? STAT_LABEL[k].replace('% ', '') : STAT_LABEL[k];
  return `<div class="istat">+${v}${pct ? '%' : ''} ${label}${range && range[0] !== range[1] ? ` <small>(${range[0]}–${range[1]})</small>` : ''}</div>`;
}

export function itemHtml(def: ItemDef, inst?: ItemInst, withPrice = false): string {
  const typeName = def.type === 'ring' ? 'Ring' : def.type[0]!.toUpperCase() + def.type.slice(1);
  let h = `<div class="iname">${esc(def.name)}</div><div class="isub">${typeName} · Level ${def.level}</div>`;
  if (def.attack) {
    const a = def.attack;
    h += `<div style="color:${ELEMENT_COLOR[a.el]}">Attack: ${a.min}–${a.max} ${ELEMENT_NAME[a.el]} · ${a.ap} AP · range ${a.range[0] === a.range[1] ? a.range[0] : a.range[0] + '–' + a.range[1]}</div>`;
  }
  for (const k of STAT_ORDER) {
    const range = def.stats?.[k];
    if (!range) continue;
    h += inst?.stats ? statLine(k, inst.stats[k] ?? 0, range) : `<div class="istat">+${range[0]}${range[0] !== range[1] ? '–' + range[1] : ''} ${STAT_LABEL[k]}</div>`;
  }
  if (def.set) {
    const set = SETS[def.set]!;
    const have = G.ch ? setCounts(G.ch)[def.set] ?? 0 : 0;
    h += `<div class="iset">${set.name} set (${have} worn)`;
    for (const [n, bonus] of Object.entries(set.bonus)) {
      const txt = Object.entries(bonus).map(([k, v]) => `+${v} ${STAT_LABEL[k as StatKey]}`).join(', ');
      h += `<div class="${have >= Number(n) ? '' : 'off'}">${n} pieces: ${txt}</div>`;
    }
    h += '</div>';
  }
  if (def.desc) h += `<div class="isub" style="margin-top:4px">${esc(def.desc)}</div>`;
  if (withPrice) h += `<div class="isub" style="margin-top:4px">Sells for <span class="gold">${sellPrice(def)} g</span></div>`;
  return h;
}

export function spellHtml(sp: SpellDef, rank: number, f: Fighter | null, err?: string | null): string {
  const range = sp.range[1] === 0 ? 'self' : sp.range[0] === sp.range[1] ? `${sp.range[0]}` : `${sp.range[0]}–${sp.range[1]}`;
  let h = `<div class="iname">${esc(sp.name)}${sp.id !== WEAPON_SPELL && rank ? ` <small style="color:#9aa3ad">rank ${rank}</small>` : ''}</div>`;
  h += `<div class="isub">${sp.ap} AP · range ${range}${sp.line ? ' · straight line' : ''}${sp.los ? ' · needs line of sight' : ''}`;
  if (sp.area) h += ` · area ${sp.area.size}`;
  if (sp.cooldown) h += ` · every ${sp.cooldown} turns`;
  if (sp.perTurn) h += ` · ${sp.perTurn} per turn`;
  h += '</div>';
  for (const e of sp.effects) {
    if (e.k === 'damage') {
      const [lo, hi] = f ? damageRange(f, e, rank) : [e.min, e.max];
      h += `<div style="color:${ELEMENT_COLOR[e.el]}">${lo}–${hi} ${ELEMENT_NAME[e.el]} damage${e.steal ? ', half returned as life' : ''}</div>`;
    } else if (e.k === 'heal') {
      const [lo, hi] = f ? healRange(f, e, rank) : [e.min, e.max];
      h += `<div style="color:#7dff9a">Heals ${lo}–${hi}</div>`;
    } else if (e.k === 'buff') {
      const what = e.stat === 'power' ? 'power' : e.stat === 'shield' ? 'shield' : e.stat.toUpperCase();
      h += `<div style="color:${e.value > 0 ? '#ffd166' : '#ff9a8a'}">${e.value > 0 ? '+' : ''}${e.value} ${what} for ${e.turns} turn${e.turns > 1 ? 's' : ''}${e.to === 'enemies' ? ' on the target' : ''}</div>`;
    } else if (e.k === 'poison') {
      const [lo, hi] = f ? damageRange(f, e, rank) : [e.min, e.max];
      h += `<div style="color:${ELEMENT_COLOR[e.el]}">${lo}–${hi} ${ELEMENT_NAME[e.el]} damage per turn for ${e.turns} turns</div>`;
    } else if (e.k === 'push') h += `<div>Pushes back ${e.dist} cells</div>`;
    else if (e.k === 'teleport') h += `<div>Teleports you to the cell</div>`;
  }
  if (sp.desc) h += `<div class="isub" style="margin-top:4px">${esc(sp.desc)}</div>`;
  if (err) h += `<div style="color:#ff9a8a;margin-top:4px">${esc(err)}</div>`;
  return h;
}

export function fighterHtml(f: Fighter): string {
  const res = (['physical', 'fire', 'storm'] as const)
    .map((e) => `<span style="color:${ELEMENT_COLOR[e]}">${f.res[e]}%</span>`).join(' / ');
  let h = `<div class="iname">${esc(f.name)}</div><div class="isub">Level ${f.level}</div>`;
  h += `<div><b style="color:#ff7a6b">${f.hp}</b> / ${f.maxHp} HP · <b style="color:#5aa0ff">${f.ap}</b> AP · <b style="color:#5fd08a">${f.mp}</b> MP</div>`;
  h += `<div class="isub">Resist (phys / fire / storm): ${res}</div>`;
  if (powerOf(f) !== f.power) h += '';
  for (const b of f.buffs) {
    const what = b.stat === 'poison' ? `${b.value} damage per turn` : `${b.value > 0 ? '+' : ''}${b.value} ${b.stat === 'power' ? 'power' : b.stat === 'shield' ? 'shield' : b.stat.toUpperCase()}`;
    h += `<div style="color:${b.stat === 'poison' || b.value < 0 ? '#ff9a8a' : '#ffd166'}">${esc(b.name)}: ${what} (${b.turns} turn${b.turns > 1 ? 's' : ''})</div>`;
  }
  return h;
}

export function groupHtml(members: { def: string; level: number }[]): string {
  const total = members.reduce((s, m) => s + m.level, 0);
  return `<div class="iname">Level ${total} group</div>` +
    members.map((m) => `<div>${esc(MONSTERS[m.def]!.name)} <span class="isub">Lv ${m.level}</span></div>`).join('') +
    `<div class="isub" style="margin-top:4px">Click to attack</div>`;
}

// ------------------------------------------------------------ bar, timeline, log

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'];

export function barSpells(): { def: SpellDef; rank: number }[] {
  const ch = G.ch;
  return [{ def: weaponSpell(ch), rank: 1 }, ...knownSpells(ch).map((s) => ({ def: s, rank: rankOf(ch, s.id) }))];
}

export function refreshBar() {
  const ch = G.ch;
  if (!ch) return;
  const d = derived(ch);
  const f = G.fight;
  const me = f ? f.st.fighters[0]! : null;
  const hp = me ? G.hero.hp ?? me.hp : Math.min(ch.hp, d.maxHp);
  const max = me ? me.maxHp : d.maxHp;
  $('name').textContent = ch.name;
  const gmOn = gmOf(ch).on;
  $('lvl').innerHTML = `Runeblade · Lv ${ch.level}${gmOn ? ' <span class="gmtag">GM</span>' : ''}`;
  ($('gmbtn') as HTMLButtonElement).hidden = !gmOn;
  $<HTMLImageElement>('face').src = portrait({ kind: 'hero', look: ch.look });
  $('hpfill').style.width = `${(100 * hp) / max}%`;
  $('hptext').textContent = `${Math.floor(hp)} / ${max}`;
  const need = xpNeed(ch.level);
  $('xpfill').style.width = ch.level >= LEVEL_CAP ? '100%' : `${(100 * ch.xp) / need}%`;
  $('xptext').textContent = ch.level >= LEVEL_CAP ? 'MAX' : `${ch.xp} / ${need} XP`;
  $('apv').textContent = String(me ? me.ap : d.ap);
  $('mpv').textContent = String(me ? me.mp : d.mp);

  const mine = !!f && f.phase === 'player';
  const view = me ?? playerFighter(ch, 0);
  let h = '';
  barSpells().forEach(({ def, rank }, i) => {
    const slot = me?.spells.find((s) => s.id === def.id);
    let off = false, cd = '';
    if (f && me && slot) {
      const sp = spellOf(f.st, def.id);
      if (slot.cd > 0) { off = true; cd = String(slot.cd); }
      else if (me.ap < sp.ap || (sp.perTurn && slot.used >= sp.perTurn) || !mine) off = true;
    }
    const sel = f?.selected === def.id;
    h += `<button class="sp${sel ? ' sel' : ''}${off ? ' off' : ''}" data-spell="${def.id}" ${tipAttr(spellHtml(def, rank, view))}>` +
      `<img src="${icon(def.icon, def.color)}" alt=""><span class="k">${KEYS[i] ?? ''}</span><span class="c">${def.ap}</span>${cd ? `<span class="cd">${cd}</span>` : ''}</button>`;
  });
  $('spells').innerHTML = h;

  const act = $<HTMLButtonElement>('act');
  act.classList.toggle('hide', !f);
  if (f) {
    act.textContent = f.phase === 'placement' ? 'Ready' : f.phase === 'player' ? 'End turn' : f.phase === 'over' ? '…' : 'Enemy turn';
    act.disabled = !(f.phase === 'placement' || f.phase === 'player');
  }
  const canRank = PLAYER_SPELLS.some((s) => s.level <= ch.level && rankOf(ch, s.id) < MAX_RANK && ch.spellPoints >= rankCost(rankOf(ch, s.id)));
  document.querySelector('[data-win=char]')!.classList.toggle('has', ch.statPoints > 0);
  document.querySelector('[data-win=spells]')!.classList.toggle('has', canRank);
  refreshQuest();
}

function refreshQuest() {
  const ch = G.ch, el = $('quest');
  const q = QUESTS[ch.quest];
  if (!q || !ch.questTaken || G.mode === 'fight') { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const done = ch.questProg >= q.count;
  el.innerHTML = `<b>${esc(q.name)}</b><br>${done ? 'Return to Old Tobin' : `${esc(MONSTERS[q.target]!.name)}: ${ch.questProg} / ${q.count}`}`;
}

export function setMapInfo() {
  const m = G.map.def;
  $('mapinfo').innerHTML = `<b>${esc(m.name)}</b><small>[${m.gx}, ${m.gy}] · ${m.levels ? `monsters Lv ${m.levels[0]}–${m.boss ? 25 : m.levels[1]}` : 'safe'}</small>`;
}

export function refreshTimeline() {
  const el = $('timeline');
  const f = G.fight;
  if (!f) { el.innerHTML = ''; return; }
  const st = f.st;
  const cur = f.phase === 'placement' ? -1 : current(st).id;
  el.innerHTML = st.order.map((id) => {
    const x = st.fighters[id]!;
    const a = G.actors.find((o) => o.fighterId === id);
    const img = x.kind === 'player' ? portrait({ kind: 'hero', look: G.ch.look }) : monsterPortrait(x.kind);
    const hp = a?.hp ?? x.hp;
    return `<div class="tl${x.team === 0 ? ' ally' : ''}${id === cur ? ' now' : ''}${hp <= 0 ? ' dead' : ''}" data-fighter="${id}">` +
      `<img src="${img}" alt=""><div><div class="n">${esc(x.name.split(',')[0]!)}</div><div class="b"><i style="width:${(100 * hp) / x.maxHp}%"></i></div></div></div>`;
  }).join('');
}

export function log(text: string, cls = '') {
  const el = $('log');
  const d = document.createElement('div');
  if (cls) d.className = cls;
  d.textContent = text;
  el.appendChild(d);
  while (el.children.length > 6) el.removeChild(el.firstChild!);
}
export function clearLog() { $('log').innerHTML = ''; }

let bannerTimer = 0;
export function banner(text: string, ms = 1300) {
  const el = $('banner');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => el.classList.remove('on'), ms);
}

export function fade(on: boolean) { $('fade').classList.toggle('on', on); }

// ------------------------------------------------------------ windows

type Sel = { kind: 'inv'; uid: number } | { kind: 'eq'; slot: Slot } | { kind: 'shop'; def: string } | null;
let open: { name: string; data?: any } | null = null;
let sel: Sel = null;
let confirming: 'stats' | 'spells' | null = null;
let draft: { name: string; look: HeroLook } = { name: '', look: { tunic: '#3f7fbf', hair: '#5a3a22', skin: '#f0c9a4', body: 'sprout' } };

export const windowOpen = () => open?.name ?? null;
export function openWindow(name: string, data?: any) {
  open = { name, data };
  sel = null;
  confirming = null;
  renderWindow();
}
export function closeWindow() {
  if (open?.name === 'create') return;
  const wasResult = open?.name === 'result';
  open = null;
  confirming = null;
  G.shop = false;
  renderWindow();
  hideTip();
  if (wasResult) actions.closeResult();
}
export function toggleWindow(name: string) {
  if (open?.name === 'result' || open?.name === 'create') return;
  if (open?.name === name) closeWindow(); else openWindow(name);
}

export function panel(title: string, body: string, closable = true, width = ''): string {
  return `<div class="panel" style="${width}"><header><b>${title}</b>${closable ? '<button data-act="close" title="Close (Esc)">×</button>' : ''}</header><div class="body">${body}</div></div>`;
}

function itemButton(inst: ItemInst | null, attrs: string, emptyLabel = ''): string {
  if (!inst) return `<div class="it empty">${emptyLabel}</div>`;
  const def = ITEMS[inst.def]!;
  const selected = (sel?.kind === 'inv' && sel.uid === inst.uid) ? ' sel' : '';
  const low = isGear(def) && def.level > G.ch.level ? ' low' : '';
  return `<button class="it${selected}${low}" ${attrs} ${tipAttr(itemHtml(def, inst))}><img src="${icon(ITEM_ICON[def.type]!, def.color)}" alt="">` +
    `${inst.qty > 1 ? `<span class="q">${inst.qty}</span>` : ''}${isGear(def) ? `<span class="l">${def.level}</span>` : ''}</button>`;
}

/** A reset button that asks once, in place, before acting. */
function resetControl(kind: 'stats' | 'spells', label: string, spent: boolean): string {
  if (confirming === kind) {
    return `<span class="row"><button class="btn go" data-act="reset-${kind}-yes">Confirm reset</button><button class="btn" data-act="reset-cancel">Cancel</button></span>`;
  }
  const why = G.mode === 'fight' ? 'Not during a fight' : spent ? 'Get every spent point back' : 'Nothing spent yet';
  return `<button class="btn" data-act="reset-${kind}" title="${why}" ${spent && G.mode !== 'fight' ? '' : 'disabled'}>${label}</button>`;
}

function charWindow(): string {
  const ch = G.ch, d = derived(ch), t = totals(ch);
  let left = `<h4>Characteristics${ch.statPoints ? ` · <span style="color:#7dff9a">${ch.statPoints} points to spend</span>` : ''}</h4>`;
  const hint: Record<BaseStat, string> = {
    vit: '+1 HP per point', str: 'Physical damage', int: 'Fire damage and healing', agi: 'Storm damage, dodging, initiative', luck: 'Critical hits and drops',
  };
  for (const k of BASE_STATS) {
    const bonus = t[k] - ch.base[k];
    left += `<div class="kv"><span title="${hint[k]}">${STAT_LABEL[k]}<br><small>${hint[k]}</small></span><span class="row"><b>${ch.base[k]}</b>${bonus ? `<b class="up">+${bonus}</b>` : ''}` +
      `<button class="btn sm" data-act="stat" data-k="${k}" data-n="1" ${ch.statPoints ? '' : 'disabled'}>+</button>` +
      `<button class="btn sm" data-act="stat" data-k="${k}" data-n="5" ${ch.statPoints >= 5 ? '' : 'disabled'}>+5</button></span></div>`;
  }
  left += `<div class="row" style="margin-top:10px;justify-content:space-between"><span class="isub">Change your build at any time.</span>${resetControl('stats', 'Reset points', BASE_STATS.some((k) => ch.base[k] > 0))}</div>`;
  const kv = (a: string, b: string | number) => `<div class="kv"><span>${a}</span><b>${b}</b></div>`;
  const right = `<h4>Combat</h4>` +
    kv('Health', `${Math.floor(Math.min(ch.hp, d.maxHp))} / ${d.maxHp}`) + kv('Action points', d.ap) + kv('Movement points', d.mp) +
    kv('Initiative', d.init) + kv('Critical hit', d.crit + '%') + kv('Power', '+' + d.power + '%') + kv('Damage', '+' + d.dmg) +
    kv('Physical resist', d.resPhysical + '%') + kv('Fire resist', d.resFire + '%') + kv('Storm resist', d.resStorm + '%') +
    `<h4>Progress</h4>` + kv('Level', ch.level) + kv('Experience', ch.level >= LEVEL_CAP ? 'max' : `${ch.xp} / ${xpNeed(ch.level)}`) + kv('Fights won', ch.wins) +
    `<div class="row" style="margin-top:10px;flex-wrap:wrap"><button class="btn" data-act="look-switch">${(ch.look.body ?? 'sprout') === 'sprout' ? 'Switch to classic look' : 'Switch to sprout look'}</button>` +
    `<button class="btn" data-act="reset">New character…</button>` +
    `<button class="btn${gmOf(ch).on ? ' gmon' : ''}" data-act="gm" data-op="toggle" title="Game-master tools for editing anything">GM mode: ${gmOf(ch).on ? 'on' : 'off'}</button></div>`;
  return panel(`${esc(ch.name)} · Runeblade level ${ch.level}`, `<div class="grid2"><div>${left}</div><div>${right}</div></div>`, true, 'width:620px');
}

function bagWindow(): string {
  const ch = G.ch;
  let eq = '<h4>Equipment</h4><div class="slots">';
  for (const s of SLOTS) {
    const inst = ch.equip[s];
    if (!inst) { eq += `<div class="it empty">${SLOT_LABEL[s]}</div>`; continue; }
    const def = ITEMS[inst.def]!;
    eq += `<button class="it${sel?.kind === 'eq' && sel.slot === s ? ' sel' : ''}" data-act="pick-eq" data-slot="${s}" ${tipAttr(itemHtml(def, inst))}><img src="${icon(ITEM_ICON[def.type]!, def.color)}" alt=""><span class="l">${def.level}</span></button>`;
  }
  eq += `</div><div style="margin-top:10px">Gold: <span class="gold">${ch.gold} g</span></div>`;
  let shop = '';
  if (G.shop) {
    shop = `<h4>Maren's goods</h4><div class="slots">` + SHOP_STOCK.map((id) => {
      const def = ITEMS[id]!;
      return `<button class="it${sel?.kind === 'shop' && sel.def === id ? ' sel' : ''}" data-act="pick-shop" data-def="${id}" ${tipAttr(itemHtml(def) + `<div class="isub">Price <span class="gold">${def.price} g</span></div>`)}>` +
        `<img src="${icon(ITEM_ICON[def.type]!, def.color)}" alt=""><span class="q gold">${def.price}</span></button>`;
    }).join('') + '</div>';
  }
  const inv = [...ch.inv].sort((a, b) => Number(isGear(ITEMS[b.def]!)) - Number(isGear(ITEMS[a.def]!)) || ITEMS[b.def]!.level - ITEMS[a.def]!.level);
  let bag = `<h4>Bag (${ch.inv.length})</h4><div class="bag">`;
  for (const inst of inv) bag += itemButton(inst, `data-act="pick-inv" data-uid="${inst.uid}"`);
  for (let k = inv.length; k < 12; k++) bag += '<div class="it empty"></div>';
  bag += '</div>';

  let detail = '<span class="isub">Select an item. Double-click to equip or use it.</span>';
  if (sel?.kind === 'inv') {
    const uid = sel.uid;
    const inst = ch.inv.find((i) => i.uid === uid);
    if (inst) {
      const def = ITEMS[inst.def]!;
      detail = itemHtml(def, inst, true) + '<div class="acts">';
      if (isGear(def)) detail += `<button class="btn go" data-act="equip" data-uid="${inst.uid}" ${def.level > ch.level ? 'disabled' : ''}>Equip</button>`;
      if (def.heal) detail += `<button class="btn go" data-act="use" data-uid="${inst.uid}" ${G.mode === 'fight' ? 'disabled' : ''}>Eat</button>`;
      if (G.shop) detail += `<button class="btn" data-act="sell" data-uid="${inst.uid}">Sell for ${sellPrice(def)} g</button>`;
      detail += '</div>';
    }
  } else if (sel?.kind === 'eq') {
    const inst = ch.equip[sel.slot];
    if (inst) detail = itemHtml(ITEMS[inst.def]!, inst, true) + `<div class="acts"><button class="btn" data-act="unequip" data-slot="${sel.slot}" ${G.mode === 'fight' ? 'disabled' : ''}>Unequip</button></div>`;
  } else if (sel?.kind === 'shop') {
    const def = ITEMS[sel.def]!;
    detail = itemHtml(def) + `<div class="acts"><button class="btn go" data-act="buy" data-def="${def.id}" ${ch.gold < def.price ? 'disabled' : ''}>Buy for ${def.price} g</button></div>`;
  }
  const body = `<div class="grid2"><div>${eq}${shop}</div><div>${bag}</div></div><div class="detail">${detail}</div>`;
  return panel(G.shop ? "Maren's shop" : 'Inventory', body, true, 'width:640px');
}

function spellsWindow(): string {
  const ch = G.ch;
  const f = playerFighter(ch, 0);
  let h = `<div class="row" style="margin-bottom:6px;justify-content:space-between;flex-wrap:wrap"><span>Spell points: <b style="color:#7dff9a">${ch.spellPoints}</b> <span class="isub">· 1 per level · each rank adds 15% to damage and healing</span></span>` +
    `${resetControl('spells', 'Reset ranks', Object.values(ch.ranks).some((r) => r > 1))}</div>`;
  const w = weaponSpell(ch);
  h += `<div class="spell"><img src="${icon(w.icon, w.color)}" alt=""><div class="t">${spellHtml(w, 1, f)}</div></div>`;
  for (const sp of PLAYER_SPELLS) {
    const known = sp.level <= ch.level, r = rankOf(ch, sp.id);
    const pips = '●'.repeat(r) + '○'.repeat(MAX_RANK - r);
    h += `<div class="spell${known ? '' : ' locked'}"><img src="${icon(sp.icon, sp.color)}" alt=""><div class="t">${spellHtml(sp, r, f)}` +
      (known ? `<div class="pips">${pips}</div>` : `<small>Unlocks at level ${sp.level}</small>`) + `</div>` +
      (known && r < MAX_RANK ? `<button class="btn" data-act="rank" data-id="${sp.id}" ${ch.spellPoints >= rankCost(r) ? '' : 'disabled'}>Rank up (${rankCost(r)})</button>` : '') + `</div>`;
  }
  return panel('Spells', h, true, 'width:520px');
}

function mapWindow(): string {
  const xs = MAPS.map((m) => m.gx), ys = MAPS.map((m) => m.gy);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let h = `<div class="wmap" style="grid-template-columns:repeat(${x1 - x0 + 1}, auto)">`;
  const tint: Record<string, string> = { village: '#5a4a2a', meadow: '#3f5a2a', forest: '#24482c', marsh: '#2c4a48', ruins: '#4c4842', hollow: '#3a2434' };
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const m = MAPS.find((o) => o.gx === x && o.gy === y);
      if (!m) { h += '<div class="wcell none"></div>'; continue; }
      h += `<div class="wcell${m.id === G.map.def.id ? ' here' : ''}" style="background:${tint[m.biome]}"><b>${esc(m.name)}</b><small>${m.levels ? `Lv ${m.levels[0]}–${m.boss ? 25 : m.levels[1]}` : 'Village'}${m.boss ? ' · boss' : ''}${m.id === G.map.def.id ? ' · you' : ''}</small></div>`;
    }
  }
  return panel('World map', h + '</div><div class="isub" style="margin-top:8px">Walk to the edge of a map (arrows on the ground) to travel.</div>');
}

function dialogWindow(d: { name: string; title: string; text: string; buttons: { label: string; act: string; go?: boolean }[]; img: string }): string {
  const btns = d.buttons.map((b) => `<button class="btn${b.go ? ' go' : ''}" data-act="npc" data-what="${b.act}">${esc(b.label)}</button>`).join('');
  return panel(`${esc(d.name)} <small style="color:#9aa3ad;font-weight:400">· ${esc(d.title)}</small>`,
    `<div class="row" style="align-items:flex-start"><img src="${d.img}" width="56" height="56" alt=""><div style="max-width:380px">${d.text}</div></div><div class="row" style="margin-top:12px;justify-content:flex-end">${btns}</div>`);
}

function resultWindow(d: { win: boolean; xp: number; gold: number; items: ItemInst[]; levels: number; quest?: string }): string {
  if (!d.win) {
    return panel('Defeated', `<div class="big" style="color:#ff7a6b">You fall…</div><p>You wake by the portal in Emberhollow, shaken but alive.</p><div class="row" style="justify-content:flex-end"><button class="btn go" data-act="close">Continue</button></div>`, false);
  }
  let h = `<div class="big" style="color:#7dff9a">Victory</div><div style="margin:6px 0">+<b style="color:#c78bff">${d.xp} XP</b> · +<span class="gold">${d.gold} g</span></div>`;
  if (d.levels) h += `<div style="color:#ffb347;font-weight:700">Level up! You are now level ${G.ch.level}. +${d.levels * 5} characteristic points, +${d.levels} spell point${d.levels > 1 ? 's' : ''}.</div>`;
  if (d.quest) h += `<div style="color:#ffb347">${esc(d.quest)}</div>`;
  h += `<h4>Loot</h4>`;
  h += d.items.length ? `<div class="loot">${d.items.map((i) => itemButton(i, 'data-act="noop"')).join('')}</div>` : '<span class="isub">Nothing this time.</span>';
  h += `<div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn go" data-act="close">Continue</button></div>`;
  return panel('Fight over', h, false, 'width:380px');
}

const TUNICS = ['#3f7fbf', '#b5533c', '#4f9a5a', '#8a5ac0', '#d0a03a', '#3a4a5a'];
const HAIRS = ['#5a3a22', '#1f1a1a', '#d8b04a', '#b5482c', '#e8e4da', '#3a6a8a'];
const SKINS = ['#f0c9a4', '#d9a784', '#a8744e', '#6f4a34'];

function createWindow(): string {
  const sw = (list: string[], key: keyof HeroLook) => list.map((col) =>
    `<button class="sw${draft.look[key] === col ? ' sel' : ''}" style="background:${col}" data-act="look" data-k="${key}" data-v="${col}"></button>`).join('');
  const body = `<p style="margin-top:0;max-width:420px">You are a <b style="color:#ffb347">Runeblade</b>: a wandering fighter who cuts with steel and with the storm and fire bound in its runes. The village of Emberhollow needs one.</p>` +
    `<div class="row" style="align-items:flex-start;gap:16px"><img src="${portrait({ kind: 'hero', look: draft.look })}" width="96" height="96" style="background:#151a21;border-radius:12px;border:1px solid #3a4554" alt="">` +
    `<div style="flex:1"><h4>Name</h4><input id="cname" type="text" maxlength="16" placeholder="Your name" value="${esc(draft.name)}">` +
    `<h4>Look</h4><div class="row">${(['sprout', 'classic'] as const).map((b) => `<button class="btn${(draft.look.body ?? 'sprout') === b ? ' go' : ''}" data-act="body" data-v="${b}">${b === 'sprout' ? 'Sprout' : 'Classic'}</button>`).join('')}</div>` +
    (draft.look.body === 'classic' ? `<h4>Tunic</h4><div class="row">${sw(TUNICS, 'tunic')}</div><h4>Hair</h4><div class="row">${sw(HAIRS, 'hair')}</div><h4>Skin</h4><div class="row">${sw(SKINS, 'skin')}</div>` : '') +
    `</div></div>` +
    `<div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn go" data-act="create">Begin</button></div>`;
  return panel('Shardfall · new character', body, false);
}

export function renderWindow() {
  const el = $('win');
  if (!open) { el.classList.remove('on'); el.innerHTML = ''; return; }
  const cname = document.getElementById('cname') as HTMLInputElement | null;
  if (cname) draft.name = cname.value;
  let h = '';
  switch (open.name) {
    case 'char': h = charWindow(); break;
    case 'bag': h = bagWindow(); break;
    case 'spells': h = spellsWindow(); break;
    case 'map': h = mapWindow(); break;
    case 'dialog': h = dialogWindow(open.data); break;
    case 'result': h = resultWindow(open.data); break;
    case 'create': h = createWindow(); break;
    case 'gm': h = gmOf(G.ch).on ? gmWindow() : ''; break;
  }
  el.innerHTML = h;
  el.classList.add('on');
}

export function refresh() {
  refreshBar();
  refreshTimeline();
  if (open) renderWindow();
}

// ------------------------------------------------------------ events

export function initHud() {
  $('win').addEventListener('click', (ev) => {
    const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t) {
      if (ev.target === $('win') && open && open.name !== 'result' && open.name !== 'create') closeWindow();
      return;
    }
    const d = t.dataset;
    switch (d.act) {
      case 'close': closeWindow(); break;
      case 'gm': {
        const args: Record<string, string> = {};
        for (const [k, v] of Object.entries(d)) if (k !== 'act' && k !== 'op' && v !== undefined) args[k] = v;
        actions.gm(d.op!, args);
        break;
      }
      case 'gm-tab': gm.tab = d.v as typeof gm.tab; renderWindow(); break;
      case 'gm-pick': gm.pick = d.def!; gm.custom = {}; renderWindow(); break;
      case 'gm-roll': gm.roll = d.v as typeof gm.roll; renderWindow(); break;
      case 'gm-edit': gm.edit = Number(d.uid); renderWindow(); break;
      case 'gm-clear': gm.confirmClear = true; renderWindow(); break;
      case 'gm-clear-cancel': gm.confirmClear = false; renderWindow(); break;
      case 'gm-member-add': gm.group.push({ ...gm.group[gm.group.length - 1]! }); renderWindow(); break;
      case 'gm-member-del': gm.group.splice(Number(d.i), 1); renderWindow(); break;
      case 'stat': actions.raiseStat(d.k as BaseStat, Number(d.n)); break;
      case 'rank': actions.raiseSpell(d.id!); break;
      case 'reset-stats': confirming = 'stats'; renderWindow(); break;
      case 'reset-spells': confirming = 'spells'; renderWindow(); break;
      case 'reset-cancel': confirming = null; renderWindow(); break;
      case 'reset-stats-yes': confirming = null; actions.resetStats(); break;
      case 'reset-spells-yes': confirming = null; actions.resetSpells(); break;
      case 'pick-inv': sel = { kind: 'inv', uid: Number(d.uid) }; renderWindow(); break;
      case 'pick-eq': sel = { kind: 'eq', slot: d.slot as Slot }; renderWindow(); break;
      case 'pick-shop': sel = { kind: 'shop', def: d.def! }; renderWindow(); break;
      case 'equip': actions.equip(Number(d.uid)); sel = null; refresh(); break;
      case 'unequip': actions.unequip(d.slot as Slot); sel = null; refresh(); break;
      case 'use': actions.use(Number(d.uid)); if (!G.ch.inv.some((i) => i.uid === Number(d.uid))) sel = null; refresh(); break;
      case 'sell': actions.sell(Number(d.uid)); if (!G.ch.inv.some((i) => i.uid === Number(d.uid))) sel = null; refresh(); break;
      case 'buy': actions.buy(d.def!); refresh(); break;
      case 'npc': actions.npc(d.what!); break;
      case 'reset':
        openWindow('dialog', {
          name: 'New character', title: 'this cannot be undone', img: portrait({ kind: 'hero', look: G.ch.look }),
          text: `Start over with a new character? <b>${esc(G.ch.name)}</b> (level ${G.ch.level}) is deleted.`,
          buttons: [{ label: 'Keep playing', act: 'bye' }, { label: 'Delete and start over', act: 'resetYes', go: true }],
        });
        break;
      case 'look': draft.look = { ...draft.look, [d.k!]: d.v! }; renderWindow(); break;
      case 'body': draft.look = { ...draft.look, body: d.v as 'sprout' | 'classic' }; renderWindow(); break;
      case 'look-switch': actions.setBody((G.ch.look.body ?? 'sprout') === 'sprout' ? 'classic' : 'sprout'); break;
      case 'create': {
        const name = ($('cname') as HTMLInputElement).value.trim() || 'Wanderer';
        open = null;
        renderWindow();
        actions.create(name, draft.look);
        break;
      }
    }
    hideTip();
  });
  // GM inputs apply when their value is committed (Enter, leaving the field, or a pick in a list).
  $('win').addEventListener('change', (ev) => {
    const t = ev.target as HTMLInputElement | HTMLSelectElement;
    if (t.id === 'gm-type') { gm.type = t.value; $('gm-list').innerHTML = gmItemList(); return; }
    const op = t.dataset.gm;
    if (!op) return;
    const d = t.dataset;
    if (op === 'qty') { gm.qty = Math.max(1, Math.round(Number(t.value) || 1)); return; }
    if (op === 'custom') { gm.custom[d.k as StatKey] = Math.round(Number(t.value) || 0); return; }
    if (op === 'member') { gm.group[Number(d.i)]!.def = t.value; return; }
    if (op === 'memberLevel') { gm.group[Number(d.i)]!.level = Math.max(1, Math.min(50, Math.round(Number(t.value) || 1))); return; }
    const value = t instanceof HTMLInputElement && t.type === 'checkbox' ? t.checked : t instanceof HTMLInputElement && t.type === 'number' ? Number(t.value) : t.value;
    actions.gm(op, { ...d, value } as Record<string, string | number | boolean>);
  });
  $('win').addEventListener('input', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.id === 'gm-search') { gm.search = t.value; $('gm-list').innerHTML = gmItemList(); }
  });
  $('win').addEventListener('dblclick', (ev) => {
    const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-act=pick-inv]');
    if (!t) return;
    const inst = G.ch.inv.find((i) => i.uid === Number(t.dataset.uid));
    if (!inst) return;
    const def = ITEMS[inst.def]!;
    if (isGear(def)) actions.equip(inst.uid); else if (def.heal) actions.use(inst.uid);
    sel = null;
    refresh();
  });
  $('spells').addEventListener('click', (ev) => {
    const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-spell]');
    if (t) actions.selectSpell(t.dataset.spell!);
  });
  $('menu').addEventListener('click', (ev) => {
    const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-win]');
    if (t) toggleWindow(t.dataset.win!);
  });
  $('act').addEventListener('click', () => actions.act());
  document.addEventListener('mouseover', (ev) => {
    const t = (ev.target as HTMLElement).closest?.<HTMLElement>('[data-tip],[data-fighter]');
    if (!t) return;
    const r = t.getBoundingClientRect();
    if (t.dataset.fighter !== undefined && G.fight) {
      const f = G.fight.st.fighters[Number(t.dataset.fighter)];
      if (f) showTip(fighterHtml(f), r.left - 200, r.top + 60);
      return;
    }
    let html = tips.get(t.dataset.tip!);
    if (!html) return;
    if (t.dataset.spell && G.fight && G.fight.phase === 'player') {
      const me = G.fight.st.fighters[0]!;
      const slot = me.spells.find((s) => s.id === t.dataset.spell);
      const sp = spellOf(G.fight.st, t.dataset.spell);
      if (slot && (slot.cd > 0 || me.ap < sp.ap || (sp.perTurn && slot.used >= sp.perTurn))) {
        html += `<div style="color:#ff9a8a;margin-top:4px">${castError(G.fight.st, me, sp.id, -1) ?? ''}</div>`;
      }
    }
    showTip(html, r.left + r.width / 2, r.top);
  });
  document.addEventListener('mouseout', (ev) => {
    if ((ev.target as HTMLElement).closest?.('[data-tip],[data-fighter]')) hideTip();
  });
}
