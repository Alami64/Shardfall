/**
 * The prototype party: one level for all three heroes and each hero's loadout
 * (one spell per pair), both picked in the windows. Kept in this browser
 * between visits; `?level=N` in the URL overrides the saved level.
 */
import { MAX_LEVEL, type FighterSetup } from '@shardfall/shared';
import { PARTY_LEVEL, partySetups, type PartyLoadouts } from './fight/setup';

const STORAGE_KEY = 'shardfall.party';

interface Saved {
  level: number;
  loadouts: PartyLoadouts;
}

const clampLevel = (n: number) => Math.min(MAX_LEVEL, Math.max(1, Math.round(n)));

function load(): Saved {
  let saved: Saved = { level: PARTY_LEVEL, loadouts: {} };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Saved>) : {};
    if (typeof parsed.level === 'number') saved.level = clampLevel(parsed.level);
    if (parsed.loadouts && typeof parsed.loadouts === 'object') saved.loadouts = parsed.loadouts;
  } catch {
    // No storage (private window, blocked site data): the defaults stand.
  }
  const fromUrl = Number(new URLSearchParams(window.location.search).get('level'));
  if (fromUrl) saved = { ...saved, level: clampLevel(fromUrl) };
  return saved;
}

let current = load();

function save() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Not saved; the choice still holds for this visit.
  }
}

export const party = {
  level: () => current.level,

  setLevel(level: number) {
    current = { ...current, level: clampLevel(level) };
    save();
  },

  equip(classId: string, pairId: string, spellId: string) {
    const loadout = { ...current.loadouts[classId], [pairId]: spellId };
    current = { ...current, loadouts: { ...current.loadouts, [classId]: loadout } };
    save();
  },

  /** The three heroes as they would enter a fight now. */
  setups: (): FighterSetup[] => partySetups(current.level, current.loadouts),
};
