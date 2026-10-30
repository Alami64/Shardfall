/**
 * The status bar along the bottom of the screen: messages on the left, the
 * party and the life orb in the middle, menus, spell slots and fight buttons on
 * the right. Scenes push what to show; clicks come back through handlers.
 */
import { el, onClick } from '../hud';
import { spellName } from '../fight/describe';
import type { CharacterView } from './characters';

/** Spell slots on the bar: one per spell pair a class will have. */
export const SLOT_COUNT = 10;

export type BarMode = 'explore' | 'placement' | 'player' | 'waiting' | 'ended';

export interface BarState {
  party: CharacterView[];
  /** The hero picked in the party list (whose windows open). */
  selected: string;
  /** The hero in the orb and the slots: the one whose turn it is, else the selected one. */
  focus: CharacterView | null;
  /** The spell being aimed, if any. */
  aiming: string | null;
  mode: BarMode;
}

let selectHandler: ((id: string) => void) | undefined;
let slotHandler: ((spellId: string) => void) | undefined;
let wired = false;
let toastTimer: number | undefined;

function wire() {
  if (wired) return;
  wired = true;
  el('party').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-hero]');
    if (btn?.dataset.hero) selectHandler?.(btn.dataset.hero);
  });
  el('slots').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-spell]');
    if (btn && !btn.disabled && btn.dataset.spell) slotHandler?.(btn.dataset.spell);
  });
}

export const bar = {
  /** Where party clicks and spell slot clicks go; scenes set these when they start. */
  on(handlers: { select: (heroId: string) => void; slot: (spellId: string) => void }) {
    wire();
    selectHandler = handlers.select;
    slotHandler = handlers.slot;
  },

  onButton(id: 'btn-ready' | 'btn-end-turn' | 'btn-flee', handler: () => void) {
    onClick(id, handler);
  },

  render(s: BarState) {
    el('party').replaceChildren(
      ...s.party.map((h) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.hero = h.id;
        b.setAttribute('aria-pressed', String(h.id === s.selected));
        b.className = h.alive ? '' : 'down';
        b.title = `${h.name}: ${h.hp}/${h.maxHp} HP`;
        const dot = document.createElement('span');
        dot.className = `dot ${h.id}`;
        b.append(dot, h.name);
        return b;
      }),
    );

    const f = s.focus;
    const pct = f ? Math.max(0, Math.min(100, (100 * f.hp) / Math.max(1, f.maxHp))) : 0;
    el('orb').style.setProperty('--hp', `${pct}%`);
    el('orb').setAttribute('aria-label', f ? `${f.name}: ${f.hp} of ${f.maxHp} HP` : 'Life');
    el('orb-hp').textContent = f ? String(f.hp) : '–';
    el('orb-max').textContent = f ? `/ ${f.maxHp}` : '';
    el('orb-name').textContent = f?.name ?? '';
    el('orb-level').textContent = f ? `Level ${f.level}` : '';
    el('orb-ap').textContent = f ? String(f.ap) : '–';
    el('orb-mp').textContent = f ? String(f.mp) : '–';

    // In a fight the slots cast; while exploring they open the spell's description.
    const casting = s.mode === 'player';
    const slots: HTMLElement[] = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const spell = f?.spells[i];
      const b = document.createElement('button');
      b.type = 'button';
      if (!spell) {
        b.className = 'slot empty';
        b.disabled = true;
        b.setAttribute('aria-label', 'Empty slot');
        slots.push(b);
        continue;
      }
      b.className = 'slot';
      b.dataset.spell = spell.id;
      b.setAttribute('aria-pressed', String(spell.id === s.aiming));
      const name = spellName(spell.id);
      b.disabled = casting && spell.blocked !== null;
      b.title = casting && spell.blocked ? `${name}: ${spell.blocked}` : `${name} · ${spell.data.apCost} AP`;
      const key = document.createElement('kbd');
      key.textContent = i < 9 ? String(i + 1) : '';
      const label = document.createElement('span');
      label.className = 'slot-name';
      label.textContent = name;
      const cost = document.createElement('span');
      cost.className = 'slot-cost';
      cost.textContent = `${spell.data.apCost} AP`;
      b.append(key, label, cost);
      if (s.mode !== 'explore' && spell.cooldown > 0) {
        const cd = document.createElement('span');
        cd.className = 'cooldown';
        cd.textContent = String(spell.cooldown);
        b.append(cd);
      }
      slots.push(b);
    }
    el('slots').replaceChildren(...slots);

    el('btn-ready').hidden = s.mode !== 'placement';
    el('btn-end-turn').hidden = s.mode !== 'player';
    el('btn-flee').hidden = s.mode !== 'player';
  },

  log(line: string, kind: 'turn' | 'hit' | 'heal' | 'info' | 'system' = 'info') {
    const box = el('log');
    const p = document.createElement('p');
    p.className = `log-${kind}`;
    p.textContent = line;
    box.append(p);
    while (box.childElementCount > 60) box.firstElementChild?.remove();
    box.scrollTop = box.scrollHeight;
  },

  clearLog() {
    el('log').replaceChildren();
  },

  hint(text: string) {
    el('hint').textContent = text;
  },

  toast(message: string) {
    const t = el('toast');
    t.textContent = message;
    t.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => t.classList.remove('show'), 1600);
  },
};
