/**
 * The fight's own HUD in index.html: turn timeline, round and timer, the card
 * for the fighter under the cursor, and the result. The status bar (ui/bar.ts)
 * carries the rest. The scene pushes state in.
 */
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

/** What the hover card shows about the fighter under the cursor. */
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

const text = (id: string, value: string) => {
  el(id).textContent = value;
};

const hpPercent = (hp: number, max: number) => `${Math.max(0, Math.min(100, (100 * hp) / Math.max(1, max)))}%`;

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

  /** The card for the fighter under the cursor, or nothing. */
  setHover(card: FighterCard | null) {
    const box = el('hover-card');
    box.hidden = card === null;
    if (!card) return;
    box.className = `hud hover-card team-${card.team}`;
    text('hc-name', card.name);
    text('hc-hp', `${card.hp}/${card.maxHp}`);
    text('hc-ap', String(card.ap));
    text('hc-mp', String(card.mp));
    el('hc-hp-fill').style.width = hpPercent(card.hp, card.maxHp);
    text('hc-notes', card.notes.join(' · '));
  },

  showResult(title: string, body: string) {
    text('result-title', title);
    text('result-text', body);
    el('fight-result').hidden = false;
  },

  onResult(handler: () => void) {
    onClick('btn-result', handler);
  },
};
