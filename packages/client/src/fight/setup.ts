/**
 * The M1 prototype encounter: the player's party of three and the monster
 * group on Brightmoor Meadow. Spells and monsters come from content; what is
 * defined here is who fights where. Monster spawns become data with M3.
 */
import { CLASS_BUILDS, heroSetup, monsterSetup, type FighterSetup, type Loadout } from '@shardfall/shared';
import { monsters, spells } from '../assets';

/** The party level until the player picks another (the meadow fight is tuned for it). */
export const PARTY_LEVEL = 6;

export interface Encounter {
  id: string;
  mapId: string;
  /** Where the group stands on the exploration map; the first cell is the leader. */
  cells: number[];
  monsters: { id: string; grade: number }[];
}

export const ENCOUNTERS: Encounter[] = [
  {
    id: 'meadow_boars',
    mapId: 'brightmoor_0_0',
    cells: [330, 344, 316],
    monsters: [
      { id: 'thornback_boar', grade: 2 },
      { id: 'thornback_boar', grade: 3 },
      { id: 'dewdrop_wisp', grade: 2 },
    ],
  },
];

/** Which sprite set draws a fighter, and whether it has a back view. */
export interface Look {
  key: string;
  hasBack: boolean;
}

/** The party's loadouts: classId → (pairId → spellId). Classes left out use their default loadout. */
export type PartyLoadouts = Record<string, Loadout>;

/** The three launch classes at one level, each with its loadout. */
export function partySetups(level = PARTY_LEVEL, loadouts: PartyLoadouts = {}): FighterSetup[] {
  return CLASS_BUILDS.map((b) => heroSetup(b.classId, spells, { level, loadout: loadouts[b.classId] }));
}

export function encounterSetups(encounter: Encounter): FighterSetup[] {
  const counts = new Map<string, number>();
  return encounter.monsters.map(({ id, grade }) => {
    const monster = monsters.find((m) => m.id === id);
    if (!monster) throw new Error(`unknown monster ${id}`);
    const n = (counts.get(id) ?? 0) + 1;
    counts.set(id, n);
    return monsterSetup(monster, grade, `${id}_${n}`, 'B');
  });
}

const MONSTER_LOOKS: Record<string, string> = { thornback_boar: 'boar', dewdrop_wisp: 'wisp' };

/** The sprite set for a monster id. */
export const monsterLook = (monsterId: string): Look => ({ key: MONSTER_LOOKS[monsterId] ?? 'boar', hasBack: false });

/** The sprite set for a fighter id (heroes are named after their class, monsters `<monster>_<n>`). */
export function lookOf(fighterId: string): Look {
  if (CLASS_BUILDS.some((b) => b.classId === fighterId)) return { key: fighterId, hasBack: true };
  return monsterLook(fighterId.replace(/_\d+$/, ''));
}

/** The idle texture for a look: heroes have front/back views, monsters a single view. */
export function textureOf(look: Look, view: 'front' | 'back', frame: number): string {
  return look.hasBack ? `${look.key}_${view}_${frame}` : `${look.key}_${frame}`;
}
