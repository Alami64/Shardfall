// The GM window: edit the character, items, world and fights. Shown only while GM mode is on.
import { ITEMS, LEVEL_CAP, MAPS, MAX_RANK, MONSTERS, PLAYER_SPELLS, QUESTS, STAT_LABEL, STAT_ORDER, type StatKey } from '../core/content.js';
import { BASE_STATS, derived, findItem, gmOf, isGear, rankOf, SLOT_LABEL, SLOTS, type RollMode } from '../core/character.js';
import type { GroupMember } from '../core/world.js';
import { icon, ITEM_ICON } from '../render/icons.js';
import { G } from '../state.js';
import { esc, panel } from './hud.js';

export type GmTab = 'char' | 'items' | 'world' | 'fight';
const TABS: [GmTab, string][] = [['char', 'Character'], ['items', 'Items'], ['world', 'World'], ['fight', 'Fight']];
const ITEM_TYPES = ['all', 'weapon', 'helm', 'cloak', 'amulet', 'ring', 'belt', 'boots', 'resource', 'food'];

/** What the GM window shows; kept between openings. */
export const gm = {
  tab: 'char' as GmTab,
  search: '',
  type: 'all',
  pick: null as string | null,
  roll: 'random' as RollMode,
  qty: 1,
  custom: {} as Partial<Record<StatKey, number>>,
  edit: null as number | null,
  confirmClear: false,
  group: [{ def: 'mossling', level: 3 }] as GroupMember[],
  speed: 1,
};

const num = (attrs: string, value: number, min?: number, max?: number) =>
  `<input type="number" class="gmnum" ${attrs} value="${value}"${min !== undefined ? ` min="${min}"` : ''}${max !== undefined ? ` max="${max}"` : ''}>`;
const row = (label: string, control: string) => `<div class="kv"><span>${label}</span><span class="row">${control}</span></div>`;
const check = (k: string, on: boolean, label: string, hint: string) =>
  `<label class="gmcheck"><input type="checkbox" data-gm="flag" data-k="${k}" ${on ? 'checked' : ''}> <span><b>${label}</b><br><small>${hint}</small></span></label>`;

function charTab(): string {
  const ch = G.ch, d = derived(ch), g = gmOf(ch);
  let left = '<h4>Character</h4>' +
    row('Name', `<input type="text" id="gm-name" class="gmtext" data-gm="name" maxlength="16" value="${esc(ch.name)}">`) +
    row('Level', num('data-gm="level"', ch.level, 1, LEVEL_CAP)) +
    row('Experience', num('data-gm="xp"', ch.xp, 0)) +
    row('Gold', num('data-gm="gold"', ch.gold, 0)) +
    row('Health', num('data-gm="hp"', Math.floor(Math.min(ch.hp, d.maxHp)), 1, d.maxHp) + ` <span class="isub">/ ${d.maxHp}</span> <button class="btn sm" data-act="gm" data-op="heal">Full</button>`) +
    row('Look', `<button class="btn sm" data-act="look-switch">${(ch.look.body ?? 'sprout') === 'sprout' ? 'Sprout' : 'Classic'}</button>`);
  left += '<h4>Characteristics</h4>';
  for (const k of BASE_STATS) left += row(STAT_LABEL[k], num(`data-gm="base" data-k="${k}"`, ch.base[k], 0));
  left += row('Points to spend', num('data-gm="statPoints"', ch.statPoints, 0)) + row('Spell points', num('data-gm="spellPoints"', ch.spellPoints, 0));

  let right = '<h4>Spell ranks</h4>';
  for (const sp of PLAYER_SPELLS) {
    right += row(`${esc(sp.name)} <small class="isub">Lv ${sp.level}</small>`, num(`data-gm="rank" data-id="${sp.id}"`, rankOf(ch, sp.id), 1, MAX_RANK));
  }
  right += check('allSpells', g.allSpells, 'All spells unlocked', 'Use every spell whatever your level') +
    check('ignoreLevel', g.ignoreLevel, 'Equip any level', 'Wear items above your level');
  right += '<h4>Quest</h4>' + row('Current quest', `<select data-gm="quest" class="gmsel">${QUESTS.map((q, i) =>
    `<option value="${i}" ${i === ch.quest ? 'selected' : ''}>${i + 1}. ${esc(q.name)}</option>`).join('')}<option value="${QUESTS.length}" ${ch.quest >= QUESTS.length ? 'selected' : ''}>All done</option></select>`) +
    `<div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn" data-act="gm" data-op="questDone" ${ch.quest >= QUESTS.length ? 'disabled' : ''}>Complete current quest</button></div>`;
  return `<div class="grid2"><div>${left}</div><div>${right}</div></div>`;
}

/** The list of items matching the search, rendered on its own so typing keeps focus. */
export function gmItemList(): string {
  const q = gm.search.trim().toLowerCase();
  const list = Object.values(ITEMS)
    .filter((d) => (gm.type === 'all' || d.type === gm.type) && (!q || d.name.toLowerCase().includes(q)))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  if (!list.length) return '<span class="isub">No item matches.</span>';
  return list.map((d) => `<button class="gmitem${gm.pick === d.id ? ' sel' : ''}" data-act="gm-pick" data-def="${d.id}">` +
    `<img src="${icon(ITEM_ICON[d.type]!, d.color)}" alt=""><span>${esc(d.name)}</span><small>Lv ${d.level}</small></button>`).join('');
}

function itemsTab(): string {
  const ch = G.ch;
  let left = `<h4>Spawn an item</h4><div class="row"><input type="text" id="gm-search" class="gmtext" placeholder="Search items" value="${esc(gm.search)}">` +
    `<select id="gm-type" class="gmsel">${ITEM_TYPES.map((t) => `<option value="${t}" ${gm.type === t ? 'selected' : ''}>${t === 'all' ? 'All types' : t}</option>`).join('')}</select></div>` +
    `<div id="gm-list" class="gmlist">${gmItemList()}</div>`;
  const def = gm.pick ? ITEMS[gm.pick] : undefined;
  if (def) {
    left += `<div class="detail"><div class="iname">${esc(def.name)}</div><div class="isub">${def.type} · level ${def.level}</div>`;
    if (isGear(def) && def.stats) {
      left += `<div class="row" style="margin:6px 0;flex-wrap:wrap">${(['random', 'min', 'max', 'custom'] as RollMode[]).map((m) =>
        `<button class="btn sm${gm.roll === m ? ' go' : ''}" data-act="gm-roll" data-v="${m}">${m === 'random' ? 'Random roll' : m === 'min' ? 'Minimum' : m === 'max' ? 'Maximum' : 'Custom'}</button>`).join('')}</div>`;
      for (const k of STAT_ORDER) {
        const r = def.stats[k];
        if (!r) continue;
        const v = gm.roll === 'custom' ? (gm.custom[k] ?? r[1]) : gm.roll === 'min' ? r[0] : gm.roll === 'max' ? r[1] : null;
        left += row(`${STAT_LABEL[k]} <small class="isub">${r[0]}–${r[1]}</small>`,
          gm.roll === 'custom' ? num(`data-gm="custom" data-k="${k}"`, v!) : `<b>${v ?? 'random'}</b>`);
      }
    }
    left += `<div class="row" style="margin-top:8px;justify-content:flex-end">Quantity ${num('id="gm-qty" data-gm="qty"', gm.qty, 1, 999)}` +
      `<button class="btn go" data-act="gm" data-op="spawn">Add to bag</button></div></div>`;
  }

  const owned = [...SLOTS.map((s) => ch.equip[s] && { it: ch.equip[s]!, where: SLOT_LABEL[s] }), ...ch.inv.map((it) => ({ it, where: 'Bag' }))]
    .filter((x): x is { it: NonNullable<typeof x>['it']; where: string } => !!x);
  let right = `<h4>Your items (${owned.length})</h4><div class="gmlist">`;
  right += owned.length ? owned.map(({ it, where }) => {
    const d = ITEMS[it.def]!;
    return `<button class="gmitem${gm.edit === it.uid ? ' sel' : ''}" data-act="gm-edit" data-uid="${it.uid}"><img src="${icon(ITEM_ICON[d.type]!, d.color)}" alt="">` +
      `<span>${esc(d.name)}${it.qty > 1 ? ` ×${it.qty}` : ''}</span><small>${where}</small></button>`;
  }).join('') : '<span class="isub">Nothing yet.</span>';
  right += '</div>';
  const it = gm.edit !== null ? findItem(ch, gm.edit) : null;
  if (it) {
    const d = ITEMS[it.def]!;
    right += `<div class="detail"><div class="iname">${esc(d.name)}</div>`;
    if (isGear(d)) {
      for (const k of STAT_ORDER) {
        const r = d.stats?.[k];
        if (!r && it.stats?.[k] === undefined) continue;
        right += row(`${STAT_LABEL[k]}${r ? ` <small class="isub">${r[0]}–${r[1]}</small>` : ''}`, num(`data-gm="itemstat" data-uid="${it.uid}" data-k="${k}"`, it.stats?.[k] ?? 0));
      }
    } else right += row('Quantity', num(`data-gm="itemqty" data-uid="${it.uid}"`, it.qty, 1, 9999));
    right += `<div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn" data-act="gm" data-op="delete" data-uid="${it.uid}">Delete</button></div></div>`;
  }
  right += `<div class="row" style="justify-content:flex-end;margin-top:8px">` + (gm.confirmClear
    ? `<span class="isub">Delete everything in the bag?</span><button class="btn go" data-act="gm" data-op="clearBag">Delete all</button><button class="btn" data-act="gm-clear-cancel">Cancel</button>`
    : `<button class="btn" data-act="gm-clear" ${ch.inv.length ? '' : 'disabled'}>Clear bag</button>`) + '</div>';
  return `<div class="grid2"><div>${left}</div><div>${right}</div></div>`;
}

function worldTab(): string {
  const inFight = G.mode === 'fight';
  let left = '<h4>Travel</h4><div class="gmmaps">' + MAPS.map((m) =>
    `<button class="btn${m.id === G.map.def.id ? ' go' : ''}" data-act="gm" data-op="goto" data-v="${m.id}" ${inFight ? 'disabled' : ''}>${esc(m.name)}<br><small>${m.levels ? `Lv ${m.levels[0]}–${m.boss ? 25 : m.levels[1]}` : 'village'}</small></button>`).join('') + '</div>';
  left += `<h4>Monsters on this map</h4><div class="row" style="flex-wrap:wrap"><button class="btn" data-act="gm" data-op="respawn" ${inFight || !G.map.def.groups ? 'disabled' : ''}>Respawn all (boss too)</button>` +
    `<button class="btn" data-act="gm" data-op="clearGroups" ${inFight || !G.map.groups.length ? 'disabled' : ''}>Remove all for 5 minutes</button></div>`;
  const monsters = Object.values(MONSTERS);
  let right = '<h4>Custom fight</h4>';
  gm.group.forEach((m, i) => {
    right += `<div class="row gmmember"><select class="gmsel" data-gm="member" data-i="${i}">${monsters.map((d) =>
      `<option value="${d.id}" ${d.id === m.def ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>` +
      `Lv ${num(`data-gm="memberLevel" data-i="${i}"`, m.level, 1, 50)}<button class="btn sm" data-act="gm-member-del" data-i="${i}" ${gm.group.length > 1 ? '' : 'disabled'} aria-label="Remove">×</button></div>`;
  });
  right += `<div class="row" style="justify-content:space-between;margin-top:8px"><button class="btn" data-act="gm-member-add" ${gm.group.length >= 8 ? 'disabled' : ''}>Add monster</button>` +
    `<button class="btn go" data-act="gm" data-op="customFight" ${inFight ? 'disabled' : ''}>Start fight</button></div>` +
    `<div class="isub" style="margin-top:6px">Up to 8 monsters. Rewards are normal.${inFight ? ' Finish the current fight first.' : ''}</div>`;
  return `<div class="grid2"><div>${left}</div><div>${right}</div></div>`;
}

function fightTab(): string {
  const g = gmOf(G.ch), inFight = G.mode === 'fight' && !!G.fight && !G.fight.st.over;
  const left = '<h4>Cheats</h4>' +
    check('invulnerable', g.invulnerable, 'Invulnerable', 'You take no damage') +
    check('oneHit', g.oneHit, 'One-hit kills', 'Every damaging spell or attack kills') +
    check('freeCast', g.freeCast, 'Free casting', 'No AP cost, no cooldowns, no per-turn limits') +
    check('infiniteMp', g.infiniteMp, 'Unlimited MP', 'Walking costs nothing and enemies cannot hold you');
  const right = '<h4>Current fight</h4>' +
    `<div class="row" style="flex-wrap:wrap"><button class="btn go" data-act="gm" data-op="win" ${inFight ? '' : 'disabled'}>Win now</button>` +
    `<button class="btn" data-act="gm" data-op="lose" ${inFight ? '' : 'disabled'}>Lose now</button>` +
    `<button class="btn" data-act="gm" data-op="refill" ${inFight ? '' : 'disabled'}>Refill AP and MP</button></div>` +
    `<div class="isub" style="margin-top:6px">${inFight ? 'Win now gives the normal rewards.' : 'Not in a fight.'}</div>` +
    '<h4>Play speed</h4>' + `<div class="row">${[1, 2, 3, 4, 5].map((n) =>
      `<button class="btn sm${gm.speed === n ? ' go' : ''}" data-act="gm" data-op="speed" data-v="${n}">${n}×</button>`).join('')}</div>`;
  return `<div class="grid2"><div>${left}</div><div>${right}</div></div>`;
}

export function gmWindow(): string {
  const tabs = `<div class="gmtabs" role="tablist">${TABS.map(([id, label]) =>
    `<button class="gmtab${gm.tab === id ? ' on' : ''}" role="tab" aria-selected="${gm.tab === id}" data-act="gm-tab" data-v="${id}">${label}</button>`).join('')}</div>`;
  const body = gm.tab === 'char' ? charTab() : gm.tab === 'items' ? itemsTab() : gm.tab === 'world' ? worldTab() : fightTab();
  return panel('<span class="gmtag">GM</span> Game master', tabs + body, true, 'width:720px');
}
