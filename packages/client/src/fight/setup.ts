/**
 * The M1 prototype encounter: the player's party of three and the monster
 * group on Brightmoor Meadow. Spells and monsters come from content; what is
 * defined here is who fights where. Monster spawns become data with M3.
 */
import { characterMaxHp, fighterStats, monsterSetup, type AiProfile, type FighterSetup, type FighterStats } from '@shardfall/shared';
import { monsters, spells } from '../assets';

/** All three spell pairs are unlocked from level 6. */
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

const HEROES: { classId: string; name: string; stats: Partial<FighterStats>; ai: AiProfile }[] = [
  {
    classId: 'vanguard',
    name: 'Vanguard',
    stats: { strength: 30, agility: 10, initiative: 10 },
    ai: { archetype: 'brute', preferredRange: 1 },
  },
  { classId: 'longshot', name: 'Longshot', stats: { agility: 30, intelligence: 10 }, ai: { archetype: 'caster', preferredRange: 5 } },
  { classId: 'mender', name: 'Mender', stats: { intelligence: 30, chance: 10 }, ai: { archetype: 'caster', preferredRange: 4 } },
];

export function partySetups(): FighterSetup[] {
  return HEROES.map((h) => ({
    id: h.classId,
    name: h.name,
    team: 'A',
    controller: 'player',
    // Kept so the AI could stand in for an idle player later; the player drives these.
    ai: h.ai,
    spells: spells.filter((s) => s.classId === h.classId).map((s) => ({ spellId: s.id, grade: 1 })),
    stats: fighterStats({ level: PARTY_LEVEL, maxHp: characterMaxHp(PARTY_LEVEL, 0), ...h.stats }),
  }));
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
  if (HEROES.some((h) => h.classId === fighterId)) return { key: fighterId, hasBack: true };
  return monsterLook(fighterId.replace(/_\d+$/, ''));
}

/** The idle texture for a look: heroes have front/back views, monsters a single view. */
export function textureOf(look: Look, view: 'front' | 'back', frame: number): string {
  return look.hasBack ? `${look.key}_${view}_${frame}` : `${look.key}_${frame}`;
}
