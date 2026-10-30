/**
 * The Characteristics and Spells windows, opened from the bar (or with C and
 * S) and closed with their × or Escape. Both show the hero picked in the
 * party list, or the tab picked in the window, and read live values in a fight.
 * While exploring they also change the party: its level (Characteristics) and
 * which spell of each pair is on the bar (Spells).
 */
import { ELEMENTS, MAX_LEVEL } from '@shardfall/shared';
import { el, onClick } from '../hud';
import { spellName } from '../fight/describe';
import { spells } from '../assets';
import type { CharacterView, SpellView } from './characters';
import { effectText, spellFacts } from './spellText';

type WindowId = 'win-stats' | 'win-spells';

let party: CharacterView[] = [];
let selected = '';
let spellShown: string | null = null;
let selectHandler: ((id: string) => void) | undefined;
/** The party level while it can be changed (exploring), else null. */
let partyLevel: number | null = null;
let partyHandlers: { level: (level: number) => void; equip: (heroId: string, pairId: string, spellId: string) => void } | undefined;
let wired = false;

const isOpen = (id: WindowId) => !el(id).hidden;

function setOpen(id: WindowId, open: boolean) {
  el(id).hidden = !open;
  el(id === 'win-stats' ? 'btn-stats' : 'btn-spells').setAttribute('aria-pressed', String(open));
  if (open) draw();
}

function wire() {
  if (wired) return;
  wired = true;
  onClick('btn-stats', () => windows.toggle('win-stats'));
  onClick('btn-spells', () => windows.toggle('win-spells'));
  for (const id of ['win-stats', 'win-spells'] as const) {
    el(id).addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-close]')) setOpen(id, false);
      const tab = target.closest<HTMLButtonElement>('button[data-hero]');
      if (tab?.dataset.hero) selectHandler?.(tab.dataset.hero);
      const spell = target.closest<HTMLButtonElement>('button[data-show-spell]');
      if (spell?.dataset.showSpell) {
        spellShown = spell.dataset.showSpell;
        draw();
      }
      const step = target.closest<HTMLButtonElement>('button[data-level-step]');
      if (step && partyLevel !== null) partyHandlers?.level(partyLevel + Number(step.dataset.levelStep));
      const equip = target.closest<HTMLButtonElement>('button[data-equip]');
      const h = hero();
      if (equip?.dataset.equip && equip.dataset.pair && h) partyHandlers?.equip(h.id, equip.dataset.pair, equip.dataset.equip);
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'c') windows.toggle('win-stats');
    else if (key === 's') windows.toggle('win-spells');
    else if (e.key === 'Escape') {
      setOpen('win-stats', false);
      setOpen('win-spells', false);
    }
  });
}

function hero(): CharacterView | undefined {
  return party.find((h) => h.id === selected) ?? party[0];
}

function tabs(container: string) {
  el(container).replaceChildren(
    ...party.map((h) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.hero = h.id;
      b.textContent = h.name;
      b.setAttribute('aria-pressed', String(h.id === hero()?.id));
      return b;
    }),
  );
}

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
};

/** "20", or "40 (+20)" with the buff part coloured when buffs change it. */
function valueCell(base: number, now: number, suffix = ''): HTMLTableCellElement {
  const td = node('td', `${now}${suffix}`);
  if (now !== base) {
    const diff = now - base;
    td.append(' ', node('span', `(${diff > 0 ? '+' : ''}${diff})`, diff > 0 ? 'bonus' : 'malus'));
  }
  return td;
}

function table(rows: [label: string, cell: HTMLTableCellElement, note?: string][]): HTMLTableElement {
  const t = node('table', undefined, 'stat-table');
  for (const [label, cell, note] of rows) {
    const tr = node('tr');
    tr.append(node('th', label), cell);
    if (note !== undefined) tr.append(node('td', note, 'note'));
    t.append(tr);
  }
  return t;
}

const button = (text: string, data: Record<string, string>, label?: string) => {
  const b = node('button', text);
  b.type = 'button';
  Object.assign(b.dataset, data);
  if (label) b.setAttribute('aria-label', label);
  return b;
};

/** − / + buttons around the party level (exploring only). */
function levelControl(level: number): HTMLElement {
  const row = node('div', undefined, 'level-control');
  const step = (n: number) => {
    const b = button(n > 0 ? `+${n}` : `−${-n}`, { levelStep: String(n) }, `${n > 0 ? 'Raise' : 'Lower'} the party level by ${Math.abs(n)}`);
    b.disabled = n < 0 ? level === 1 : level === MAX_LEVEL;
    return b;
  };
  row.append(
    node('span', 'Party level', 'label'),
    step(-10),
    step(-1),
    node('output', String(level)),
    step(1),
    step(10),
    node('span', 'Prototype: all three heroes share it', 'note'),
  );
  return row;
}

function drawStats(h: CharacterView) {
  const { base: b, stats: s } = h;
  const body = el('win-stats-body');
  const initiative = (x: typeof s) => x.initiative + x.strength + x.intelligence + x.chance + x.agility;
  body.replaceChildren(
    ...(partyLevel !== null ? [levelControl(partyLevel)] : []),
    node('h3', `${h.name} · level ${h.level}`),
    table([
      ['Health', node('td', `${h.hp} / ${h.maxHp}`)],
      ['Action points', valueCell(b.ap, s.ap), 'Spent on spells, refilled each turn'],
      ['Movement points', valueCell(b.mp, s.mp), 'One per cell walked in a fight'],
      ['Initiative', valueCell(initiative(b), initiative(s)), 'Who plays first; drops with lost HP'],
      ['Range', valueCell(b.range, s.range, ''), 'Added to spells with boostable range'],
    ]),
    node('h3', 'Characteristics'),
    table([
      ['Strength', valueCell(b.strength, s.strength), '+1% Earth and Neutral damage per point'],
      ['Intelligence', valueCell(b.intelligence, s.intelligence), '+1% Fire damage and heals per point'],
      ['Chance', valueCell(b.chance, s.chance), '+1% Water damage per point'],
      ['Agility', valueCell(b.agility, s.agility), '+1% Air damage per point'],
    ]),
    node('h3', 'Combat'),
    table([
      ['Power', valueCell(b.power, s.power), '+1% damage of every element per point'],
      ['Critical hits', valueCell(b.criticalChance, s.criticalChance, '%'), 'Added to each spell’s critical chance'],
      ['Critical damage', valueCell(b.criticalDamage, s.criticalDamage), 'Added to critical hits'],
      ['Heals', valueCell(b.heals, s.heals), 'Added to every heal'],
      ['Dodge', valueCell(b.dodge, s.dodge), 'Slips away from adjacent enemies (tackle)'],
      ['Lock', valueCell(b.lock, s.lock), 'Holds adjacent enemies in place (tackle)'],
      ['AP / MP removal', node('td', `${s.apRemoval} / ${s.mpRemoval}`), 'Chance to take points away'],
      ['AP / MP parry', node('td', `${s.apParry} / ${s.mpParry}`), 'Chance to keep your points'],
    ]),
    node('h3', 'Resistances and damage by element'),
    elementTable(h),
  );
  if (h.buffs.length) body.append(node('h3', 'Active effects'), node('p', h.buffs.join(' · ')));
}

function elementTable(h: CharacterView): HTMLTableElement {
  const t = node('table', undefined, 'stat-table');
  const head = node('tr');
  head.append(node('th', ''), node('td', 'Resist %'), node('td', 'Resist'), node('td', 'Damage'));
  t.append(head);
  for (const e of ELEMENTS) {
    const tr = node('tr');
    tr.append(
      node('th', e.charAt(0).toUpperCase() + e.slice(1)),
      valueCell(h.base.resistPercent[e], h.stats.resistPercent[e], '%'),
      valueCell(h.base.resistFlat[e], h.stats.resistFlat[e]),
      valueCell(h.base.damage[e], h.stats.damage[e]),
    );
    t.append(tr);
  }
  return t;
}

function spellButton(s: SpellView, extra: string, className = ''): HTMLButtonElement {
  const b = button('', { showSpell: s.id });
  b.className = className;
  b.setAttribute('aria-pressed', String(s.id === spellShown));
  b.append(spellName(s.id), node('span', extra));
  return b;
}

/** Fights: the spells on the bar. Exploring: every pair, both sides, the equipped one marked. */
function spellList(h: CharacterView): HTMLElement {
  const list = node('div', undefined, 'spell-list');
  if (!h.pairs.length) {
    for (const s of h.spells) list.append(spellButton(s, `${s.data.apCost} AP · grade ${s.grade}`));
    return list;
  }
  for (const p of h.pairs) {
    const group = node('div', undefined, p.unlocked ? 'pair' : 'pair locked');
    group.append(node('p', p.unlocked ? `Level ${p.unlockLevel}` : `Level ${p.unlockLevel} · locked`, 'pair-level'));
    for (const s of p.options) {
      const on = s.id === p.equipped && p.unlocked;
      group.append(spellButton(s, on ? `${s.data.apCost} AP · on the bar` : `${s.data.apCost} AP`, on ? 'equipped' : ''));
    }
    list.append(group);
  }
  return list;
}

function drawSpells(h: CharacterView) {
  const body = el('win-spells-body');
  const all = h.pairs.length ? h.pairs.flatMap((p) => p.options) : h.spells;
  if (!all.some((s) => s.id === spellShown)) spellShown = h.spells[0]?.id ?? all[0]?.id ?? null;
  const detail = node('div', undefined, 'spell-detail');
  const shown = all.find((s) => s.id === spellShown);
  const pair = h.pairs.find((p) => p.options.some((s) => s.id === spellShown));
  if (shown) {
    const spell = spells.find((x) => x.id === shown.id);
    detail.append(
      node('h4', spellName(shown.id)),
      node(
        'p',
        `Grade ${shown.grade} of ${spell?.grades.length ?? 1} · learnt at level ${spell?.unlockLevel ?? 1}`,
        'sub',
      ),
    );
    if (pair && !pair.unlocked) {
      detail.append(node('p', `Unlocks at level ${pair.unlockLevel}. Raise the party level in Characteristics to try it.`, 'state'));
    } else if (pair && pair.equipped !== shown.id) {
      const other = pair.options.find((s) => s.id === pair.equipped);
      const equip = button(`Equip instead of ${other ? spellName(other.id) : 'the other side'}`, {
        equip: shown.id,
        pair: pair.pairId,
      });
      equip.className = 'equip';
      detail.append(equip);
    } else if (pair) {
      detail.append(node('p', 'On the bar. Its pair partner can replace it out of fights.', 'sub'));
    }
    const facts = node('ul', undefined, 'facts');
    for (const f of spellFacts(shown.data, h.stats.range)) facts.append(node('li', f));
    detail.append(facts, node('h3', 'Effects'));
    const effects = node('ul');
    const selfCast = shown.data.maxRange === 0;
    for (const e of shown.data.effects) effects.append(node('li', effectText(e, selfCast)));
    detail.append(effects);
    if (shown.data.criticalEffects.length) {
      detail.append(node('h3', `Critical hit (${shown.data.criticalChance}% + your critical chance)`));
      const crit = node('ul');
      for (const e of shown.data.criticalEffects) crit.append(node('li', effectText(e, selfCast)));
      detail.append(crit);
    }
    if (shown.blocked || shown.cooldown > 0) {
      const why = shown.cooldown > 0 ? `Ready in ${shown.cooldown} turn${shown.cooldown === 1 ? '' : 's'}` : shown.blocked;
      detail.append(node('p', `Right now: ${why}`, 'state'));
    }
  }
  const layout = node('div', undefined, 'spells-layout');
  layout.append(spellList(h), detail);
  body.replaceChildren(layout);
}

function draw() {
  const h = hero();
  if (!h) return;
  if (isOpen('win-stats')) {
    tabs('win-stats-tabs');
    drawStats(h);
  }
  if (isOpen('win-spells')) {
    tabs('win-spells-tabs');
    drawSpells(h);
  }
}

export const windows = {
  /** Where a tab click goes (picking a hero); scenes set it when they start. */
  onSelect(handler: (heroId: string) => void) {
    wire();
    selectHandler = handler;
  },

  /** Where party changes go while exploring: a new level, or a spell equipped from a pair. */
  onParty(handlers: NonNullable<typeof partyHandlers>) {
    wire();
    partyHandlers = handlers;
  },

  /** New data: redraws whichever windows are open. `level` is the party level when it can be changed (exploring). */
  update(heroes: CharacterView[], selectedId: string, level: number | null = null) {
    party = heroes;
    selected = selectedId;
    partyLevel = level;
    draw();
  },

  toggle(id: WindowId) {
    setOpen(id, !isOpen(id));
  },

  /** Opens the spell window on one spell (a click on a spell slot while exploring). */
  showSpell(spellId: string) {
    spellShown = spellId;
    setOpen('win-spells', true);
  },
};
