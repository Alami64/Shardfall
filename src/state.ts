// Shared client state. game.ts owns it; the view and the HUD read it.
import type { Character, HeroLook } from './core/character.js';
import type { FightState } from './core/fight.js';
import type { GameMap, Group, Npc } from './core/world.js';
import type { AnimKind } from './render/sprites.js';

export interface Actor {
  key: string;
  kind: 'hero' | 'npc' | 'monster';
  name: string;
  look?: HeroLook;
  elder?: boolean;
  armed?: boolean;
  shape?: string;
  colors?: [string, string];
  scale: number;
  x: number;
  y: number;
  cell: number;
  facing: 1 | -1;
  /** Seen from behind (moving or looking up the map). */
  back?: boolean;
  anim?: { kind: AnimKind; t0: number; dur: number; color?: string };
  walking: boolean;
  path: number[];
  speed: number;
  onArrive?: () => void;
  onStep?: (cell: number) => void;
  alpha: number;
  flashUntil: number;
  lunge?: { dx: number; dy: number; t0: number };
  fighterId?: number;
  group?: Group;
  npc?: Npc;
  hp?: number;
  maxHp?: number;
  team?: number;
  wanderAt?: number;
}

export interface Mark { cell: number; fill: string; stroke?: string }

export interface FightUi {
  st: FightState;
  phase: 'placement' | 'player' | 'busy' | 'enemy' | 'over';
  startCells: number[];
  group: Group;
  selected: string | null;
  turnId: number;
  auto: boolean;
}

export const G = {
  ch: null as unknown as Character,
  map: null as unknown as GameMap,
  mode: 'explore' as 'explore' | 'fight',
  fight: null as FightUi | null,
  actors: [] as Actor[],
  hero: null as unknown as Actor,
  marks: [] as Mark[],
  hover: -1,
  now: 0,
  shop: false,
  ready: false,
};
