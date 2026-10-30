/**
 * The M1 prototype encounters: the player's party of three and the monster
 * groups on Brightmoor Meadow, Gildhaven Outskirts and Thornwild Edge. Spells
 * and monsters come from content; what is defined here is who fights where.
 * Monster spawns become data with M3.
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
  // Gildhaven Outskirts: for a party around level 18, then around 28 (fight-smoke.ts patrol, yard).
  {
    id: 'gildhaven_patrol',
    mapId: 'gildhaven_0_0',
    cells: [302, 316, 288],
    monsters: [
      { id: 'rustpike_sentry', grade: 3 },
      { id: 'rustpike_sentry', grade: 2 },
      { id: 'coinmoth', grade: 2 },
    ],
  },
  {
    id: 'gildhaven_yard',
    mapId: 'gildhaven_0_0',
    cells: [319, 305, 333],
    monsters: [
      { id: 'rustpike_sentry', grade: 5 },
      { id: 'rustpike_sentry', grade: 4 },
      { id: 'coinmoth', grade: 5 },
    ],
  },
  // Thornwild Edge: for a party around level 40, then around 58 (fight-smoke.ts hunt, deep).
  {
    id: 'thornwild_hunt',
    mapId: 'thornwild_0_0',
    cells: [246, 260, 232],
    monsters: [
      { id: 'bramble_stalker', grade: 3 },
      { id: 'bramble_stalker', grade: 2 },
      { id: 'mirecap', grade: 2 },
    ],
  },
  {
    id: 'thornwild_deep',
    mapId: 'thornwild_0_0',
    cells: [263, 249, 278],
    monsters: [
      { id: 'bramble_stalker', grade: 5 },
      { id: 'bramble_stalker', grade: 4 },
      { id: 'mirecap', grade: 4 },
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

const MONSTER_LOOKS: Record<string, string> = {
  thornback_boar: 'boar',
  dewdrop_wisp: 'wisp',
  rustpike_sentry: 'sentry',
  coinmoth: 'moth',
  bramble_stalker: 'stalker',
  mirecap: 'mirecap',
};

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
