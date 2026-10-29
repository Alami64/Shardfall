/** The fight HUD in index.html: turn timeline, fighter card, spell bar, log, result. The scene pushes state in. */
import type { Team } from '@shardfall/shared';
import { el, onClick } from '../hud';

export interface TimelineEntry {
  id: string;
  name: string;
  team: Team;
  hp: number;
  maxHp: number;
  alive: boolean;
  active: boolean;
}

export interface FighterCard {
  name: string;
  team: Team;
  hp: number;
  maxHp: number;
  ap: number;
  mp: number;
  /** Shield points, buffs and states, already worded. */
  notes: string[];
}

export interface SpellButton {
  id: string;
  name: string;
  ap: number;
  /** Why it cannot be cast now, or null. */
  blocked: string | null;
  selected: boolean;
}

export type FightMode = 'placement' | 'player' | 'waiting' | 'ended';

const text = (id: string, value: string) => {
  el(id).textContent = value;
};

const hpPercent = (hp: number, max: number) => `${Math.max(0, Math.min(100, (100 * hp) / Math.max(1, max)))}%`;

let toastTimer: number | undefined;

export const fightHud = {
  show(on: boolean) {
    el('fight-hud').hidden = !on;
    if (!on) el('fight-result').hidden = true;
  },

  setRound(label: string) {
    text('fight-round', label);
  },

  setTimer(seconds: number | null) {
    const t = el('fight-timer');
    t.hidden = seconds === null;
    t.textContent = seconds === null ? '' : `${seconds}s`;
    t.classList.toggle('low', seconds !== null && seconds <= 5);
  },

  setTimeline(entries: TimelineEntry[]) {
    const list = el('fight-timeline');
    list.replaceChildren(
      ...entries.map((e) => {
        const li = document.createElement('li');
        li.className = `chip team-${e.team}${e.active ? ' active' : ''}${e.alive ? '' : ' down'}`;
        li.title = `${e.name}: ${e.hp}/${e.maxHp} HP`;
        const name = document.createElement('span');
        name.className = 'chip-name';
        name.textContent = e.name;
        const bar = document.createElement('span');
        bar.className = 'chip-hp';
        const fill = document.createElement('span');
        fill.style.width = hpPercent(e.hp, e.maxHp);
        bar.append(fill);
        li.append(name, bar);
        return li;
      }),
    );
  },

  setFighter(card: FighterCard | null) {
    const box = el('fighter-card');
    box.hidden = card === null;
    if (!card) return;
    box.className = `fighter-card team-${card.team}`;
    text('fc-name', card.name);
    text('fc-hp', `${card.hp}/${card.maxHp}`);
    text('fc-ap', String(card.ap));
    text('fc-mp', String(card.mp));
    el('fc-hp-fill').style.width = hpPercent(card.hp, card.maxHp);
    text('fc-notes', card.notes.join(' · '));
  },

  setSpells(buttons: SpellButton[] | null) {
    const bar = el('spellbar');
    bar.hidden = buttons === null;
    bar.replaceChildren(
      ...(buttons ?? []).map((b, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'spell';
        btn.dataset.spell = b.id;
        btn.disabled = b.blocked !== null;
        btn.setAttribute('aria-pressed', String(b.selected));
        btn.title = b.blocked ? `${b.name}: ${b.blocked}` : `${b.name} (${b.ap} AP)`;
        const key = document.createElement('kbd');
        key.textContent = String(i + 1);
        const name = document.createElement('span');
        name.className = 'spell-name';
        name.textContent = b.name;
        const cost = document.createElement('span');
        cost.className = 'spell-cost';
        cost.textContent = b.blocked && b.blocked.startsWith('ready in') ? b.blocked.replace('ready in ', '⏳ ') : `${b.ap} AP`;
        btn.append(key, name, cost);
        return btn;
      }),
    );
  },

  setMode(mode: FightMode) {
    el('btn-ready').hidden = mode !== 'placement';
    el('btn-end-turn').hidden = mode !== 'player';
    el('btn-flee').hidden = mode !== 'player';
  },

  setHint(value: string) {
    text('fight-hint', value);
  },

  log(line: string, kind: 'turn' | 'hit' | 'heal' | 'info' = 'info') {
    const box = el('fight-log');
    const p = document.createElement('p');
    p.className = `log-${kind}`;
    p.textContent = line;
    box.append(p);
    while (box.childElementCount > 40) box.firstElementChild?.remove();
    box.scrollTop = box.scrollHeight;
  },

  clearLog() {
    el('fight-log').replaceChildren();
  },

  toast(message: string) {
    const t = el('fight-toast');
    t.textContent = message;
    t.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => t.classList.remove('show'), 1600);
  },

  showResult(title: string, body: string) {
    text('result-title', title);
    text('result-text', body);
    el('fight-result').hidden = false;
  },

  on(button: 'btn-ready' | 'btn-end-turn' | 'btn-flee' | 'btn-result', handler: () => void) {
    onClick(button, handler);
  },

  /** Spell buttons are rebuilt every update, so clicks are caught once on the bar. */
  onSpell(handler: (spellId: string) => void) {
    spellHandler = handler;
    if (spellBarWired) return;
    spellBarWired = true;
    el('spellbar').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button.spell');
      if (btn && !btn.disabled && btn.dataset.spell) spellHandler?.(btn.dataset.spell);
    });
  },
};

let spellHandler: ((spellId: string) => void) | undefined;
let spellBarWired = false;
