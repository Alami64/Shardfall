// All game content as data: spells, monsters, items, sets, maps, shop, quests.
import type { AreaShape } from './grid.js';

export type Element = 'physical' | 'fire' | 'storm';
export const ELEMENT_NAME: Record<Element, string> = { physical: 'Physical', fire: 'Fire', storm: 'Storm' };
export const ELEMENT_COLOR: Record<Element, string> = { physical: '#e8d9b5', fire: '#ff8a47', storm: '#7fd6ff' };

export type StatKey =
  | 'vit' | 'str' | 'int' | 'agi' | 'luck'
  | 'ap' | 'mp' | 'power' | 'dmg' | 'crit' | 'init'
  | 'resPhysical' | 'resFire' | 'resStorm';

export const STAT_LABEL: Record<StatKey, string> = {
  vit: 'Vitality', str: 'Strength', int: 'Intellect', agi: 'Agility', luck: 'Luck',
  ap: 'AP', mp: 'MP', power: 'Power', dmg: 'Damage', crit: '% Critical', init: 'Initiative',
  resPhysical: '% Physical resist', resFire: '% Fire resist', resStorm: '% Storm resist',
};
export const STAT_ORDER: StatKey[] = [
  'ap', 'mp', 'vit', 'str', 'int', 'agi', 'luck', 'power', 'dmg', 'crit', 'init', 'resPhysical', 'resFire', 'resStorm',
];

// ---------------------------------------------------------------- spells

export type Side = 'self' | 'enemies' | 'allies';
export type Effect =
  | { k: 'damage'; el: Element; min: number; max: number; steal?: boolean }
  | { k: 'heal'; min: number; max: number }
  | { k: 'buff'; stat: 'ap' | 'mp' | 'power' | 'shield'; value: number; turns: number; to: Side; name: string }
  | { k: 'poison'; el: Element; min: number; max: number; turns: number; name: string }
  | { k: 'push'; dist: number }
  | { k: 'teleport' };

export interface SpellDef {
  id: string;
  name: string;
  icon: string;
  color: string;
  /** Character level that unlocks it (player spells). */
  level: number;
  ap: number;
  range: [number, number];
  los: boolean;
  line?: boolean;
  target: 'fighter' | 'empty' | 'self' | 'cell';
  area?: { shape: AreaShape; size: number };
  cooldown?: number;
  perTurn?: number;
  effects: Effect[];
  desc: string;
}

const S = (s: SpellDef) => s;

export const PLAYER_SPELLS: SpellDef[] = [
  S({ id: 'runeSlash', name: 'Rune Slash', icon: 'slash', color: '#e8d9b5', level: 1, ap: 3, range: [1, 1], los: false, target: 'fighter',
    effects: [{ k: 'damage', el: 'physical', min: 6, max: 9 }], desc: 'A quick cut with a rune-etched edge.' }),
  S({ id: 'emberBolt', name: 'Ember Bolt', icon: 'flame', color: '#ff8a47', level: 1, ap: 4, range: [2, 6], los: true, target: 'fighter',
    effects: [{ k: 'damage', el: 'fire', min: 7, max: 10 }], desc: 'Hurls a knot of living embers.' }),
  S({ id: 'blinkStep', name: 'Blink Step', icon: 'step', color: '#c9a6ff', level: 3, ap: 2, range: [1, 4], los: false, target: 'empty', cooldown: 3,
    effects: [{ k: 'teleport' }], desc: 'Step through the rune-light to a free cell.' }),
  S({ id: 'staticSnare', name: 'Static Snare', icon: 'snare', color: '#7fd6ff', level: 5, ap: 3, range: [1, 5], los: true, target: 'fighter', perTurn: 2,
    effects: [{ k: 'damage', el: 'storm', min: 5, max: 8 }, { k: 'buff', stat: 'mp', value: -2, turns: 1, to: 'enemies', name: 'Snared' }],
    desc: 'A crackling tether that slows the target.' }),
  S({ id: 'secondWind', name: 'Second Wind', icon: 'heart', color: '#7dff9a', level: 7, ap: 2, range: [0, 0], los: false, target: 'self', cooldown: 3,
    effects: [{ k: 'heal', min: 14, max: 20 }], desc: 'Draw breath and mend your wounds.' }),
  S({ id: 'stormRing', name: 'Storm Ring', icon: 'ring', color: '#7fd6ff', level: 10, ap: 4, range: [0, 0], los: false, target: 'self',
    area: { shape: 'ring', size: 2 }, perTurn: 1,
    effects: [{ k: 'damage', el: 'storm', min: 10, max: 14 }], desc: 'Lightning arcs to every enemy within 2 cells.' }),
  S({ id: 'battleTrance', name: 'Battle Trance', icon: 'trance', color: '#ffd166', level: 13, ap: 2, range: [0, 0], los: false, target: 'self', cooldown: 5,
    effects: [{ k: 'buff', stat: 'power', value: 40, turns: 3, to: 'self', name: 'Trance' }], desc: 'Your runes flare: more power for 3 turns.' }),
  S({ id: 'sunderingBlow', name: 'Sundering Blow', icon: 'hammer', color: '#e8d9b5', level: 16, ap: 5, range: [1, 1], los: false, target: 'fighter', perTurn: 1,
    effects: [{ k: 'damage', el: 'physical', min: 19, max: 25 }, { k: 'push', dist: 2 }], desc: 'A crushing strike that throws the target back.' }),
  S({ id: 'cinderfall', name: 'Cinderfall', icon: 'meteor', color: '#ff8a47', level: 20, ap: 5, range: [3, 7], los: true, target: 'cell',
    area: { shape: 'circle', size: 1 }, cooldown: 2,
    effects: [{ k: 'damage', el: 'fire', min: 16, max: 21 }], desc: 'Burning cinders rain on a small area.' }),
  S({ id: 'leechingEdge', name: 'Leeching Edge', icon: 'leech', color: '#ff6b8b', level: 24, ap: 4, range: [1, 2], los: false, line: true, target: 'fighter',
    effects: [{ k: 'damage', el: 'physical', min: 12, max: 16, steal: true }], desc: 'A hungry cut: half the damage returns as life.' }),
];

export const MONSTER_SPELLS: SpellDef[] = [
  S({ id: 'm_thump', name: 'Thump', icon: 'fist', color: '#e8d9b5', level: 1, ap: 3, range: [1, 1], los: false, target: 'fighter', perTurn: 1,
    effects: [{ k: 'damage', el: 'physical', min: 3, max: 5 }], desc: '' }),
  S({ id: 'm_dart', name: 'Thorn Dart', icon: 'slash', color: '#e8d9b5', level: 1, ap: 3, range: [2, 5], los: true, target: 'fighter', perTurn: 1,
    effects: [{ k: 'damage', el: 'physical', min: 3, max: 4 }], desc: '' }),
  S({ id: 'm_gore', name: 'Gore', icon: 'slash', color: '#e8d9b5', level: 1, ap: 4, range: [1, 1], los: false, target: 'fighter', perTurn: 1,
    effects: [{ k: 'damage', el: 'physical', min: 5, max: 7 }], desc: '' }),
  S({ id: 'm_spore', name: 'Burning Spores', icon: 'flame', color: '#ff8a47', level: 1, ap: 4, range: [1, 4], los: true, target: 'fighter', perTurn: 1,
    effects: [{ k: 'damage', el: 'fire', min: 3, max: 4 }, { k: 'poison', el: 'fire', min: 3, max: 4, turns: 2, name: 'Spores' }], desc: '' }),
  S({ id: 'm_drag', name: 'Drag Under', icon: 'slash', color: '#e8d9b5', level: 1, ap: 4, range: [1, 1], los: false, target: 'fighter', perTurn: 1,
    effects: [{ k: 'damage', el: 'physical', min: 6, max: 8 }, { k: 'buff', stat: 'mp', value: -1, turns: 1, to: 'enemies', name: 'Mired' }], desc: '' }),
  S({ id: 'm_spark', name: 'Fen Spark', icon: 'snare', color: '#7fd6ff', level: 1, ap: 4, range: [2, 7], los: true, target: 'fighter', perTurn: 1,
    effects: [{ k: 'damage', el: 'storm', min: 6, max: 8 }], desc: '' }),
  S({ id: 'm_crush', name: 'Crush', icon: 'hammer', color: '#e8d9b5', level: 1, ap: 4, range: [1, 1], los: false, target: 'fighter', perTurn: 1,
    effects: [{ k: 'damage', el: 'physical', min: 7, max: 9 }], desc: '' }),
  S({ id: 'm_bulwark', name: 'Bulwark', icon: 'trance', color: '#ffd166', level: 1, ap: 2, range: [0, 0], los: false, target: 'self', cooldown: 5,
    effects: [{ k: 'buff', stat: 'shield', value: 3, turns: 2, to: 'self', name: 'Bulwark' }], desc: '' }),
  S({ id: 'm_darkflame', name: 'Hollow Flame', icon: 'flame', color: '#ff8a47', level: 1, ap: 4, range: [2, 6], los: true, target: 'fighter', perTurn: 1,
    effects: [{ k: 'damage', el: 'fire', min: 6, max: 8 }], desc: '' }),
  S({ id: 'm_mend', name: 'Mend', icon: 'heart', color: '#7dff9a', level: 1, ap: 3, range: [0, 5], los: false, target: 'fighter', cooldown: 3,
    effects: [{ k: 'heal', min: 6, max: 9 }], desc: '' }),
  S({ id: 'm_briar', name: 'Briar Whip', icon: 'slash', color: '#e8d9b5', level: 1, ap: 4, range: [1, 2], los: false, line: true, target: 'fighter', perTurn: 1,
    effects: [{ k: 'damage', el: 'physical', min: 6, max: 8 }], desc: '' }),
  S({ id: 'm_lash', name: 'Root Lash', icon: 'slash', color: '#e8d9b5', level: 1, ap: 3, range: [1, 3], los: false, line: true, target: 'fighter', perTurn: 2,
    effects: [{ k: 'damage', el: 'physical', min: 6, max: 8 }], desc: '' }),
  S({ id: 'm_quake', name: 'Heartwood Quake', icon: 'ring', color: '#e8d9b5', level: 1, ap: 4, range: [0, 0], los: false, target: 'self',
    area: { shape: 'ring', size: 2 }, cooldown: 2,
    effects: [{ k: 'damage', el: 'physical', min: 6, max: 9 }, { k: 'buff', stat: 'mp', value: -1, turns: 1, to: 'enemies', name: 'Shaken' }], desc: '' }),
  S({ id: 'm_volley', name: 'Thorn Volley', icon: 'meteor', color: '#e8d9b5', level: 1, ap: 3, range: [4, 9], los: true, target: 'fighter', perTurn: 1,
    effects: [{ k: 'damage', el: 'physical', min: 4, max: 6 }], desc: '' }),
];

export const SPELLS: Record<string, SpellDef> = Object.fromEntries(
  [...PLAYER_SPELLS, ...MONSTER_SPELLS].map((s) => [s.id, s]),
);

export const MAX_RANK = 5;
/** Damage and healing multiplier of a spell rank. */
export const rankMult = (rank: number) => 1 + 0.15 * (rank - 1);
/** Spell points needed to go from this rank to the next. */
export const rankCost = (rank: number) => rank;

// ---------------------------------------------------------------- monsters

export interface MonsterDef {
  id: string;
  name: string;
  shape: string;
  colors: [string, string];
  scale: number;
  /** [base, per level] */
  hp: [number, number];
  stat: [number, number];
  agi: [number, number];
  ap: number;
  mp: number;
  res: Record<Element, number>;
  spells: string[];
  ai: 'melee' | 'ranged' | 'support';
  xp: number;
  gold: [number, number];
  drops: { item: string; p: number }[];
  boss?: boolean;
}

export const MONSTERS: Record<string, MonsterDef> = {
  mossling: { id: 'mossling', name: 'Mossling', shape: 'blob', colors: ['#6fae4a', '#3f7a2b'], scale: 1,
    hp: [11, 3.4], stat: [5, 5], agi: [0, 1.5], ap: 4, mp: 3, res: { physical: 0, fire: -10, storm: 5 },
    spells: ['m_thump'], ai: 'melee', xp: 1, gold: [1, 3],
    drops: [{ item: 'moss_tuft', p: 0.5 }, { item: 'moss_hood', p: 0.07 }, { item: 'moss_cape', p: 0.06 }, { item: 'moss_sandals', p: 0.05 }] },
  thistle: { id: 'thistle', name: 'Thistle Imp', shape: 'thistle', colors: ['#b072d6', '#6d3f94'], scale: 0.95,
    hp: [8, 2.6], stat: [5, 5], agi: [5, 2], ap: 4, mp: 3, res: { physical: 5, fire: -10, storm: 0 },
    spells: ['m_dart'], ai: 'ranged', xp: 1.1, gold: [1, 4],
    drops: [{ item: 'sprite_dust', p: 0.45 }, { item: 'thistle_charm', p: 0.07 }, { item: 'sprite_band', p: 0.06 }, { item: 'thorn_wand', p: 0.04 }] },
  boar: { id: 'boar', name: 'Barkhide Boar', shape: 'boar', colors: ['#8a6a4a', '#5a4130'], scale: 1.05,
    hp: [16, 3.3], stat: [5, 5], agi: [0, 1.5], ap: 4, mp: 4, res: { physical: 10, fire: 0, storm: -5 },
    spells: ['m_gore'], ai: 'melee', xp: 1.1, gold: [2, 4],
    drops: [{ item: 'boar_tusk', p: 0.45 }, { item: 'boar_belt', p: 0.06 }, { item: 'boar_boots', p: 0.05 }, { item: 'boar_helm', p: 0.04 }, { item: 'tusk_cleaver', p: 0.04 }, { item: 'bark_ring', p: 0.05 }] },
  gloomcap: { id: 'gloomcap', name: 'Gloomcap', shape: 'shroom', colors: ['#7c5fb0', '#e9dcc0'], scale: 1,
    hp: [11, 2.8], stat: [5, 5], agi: [0, 1], ap: 4, mp: 2, res: { physical: 0, fire: 10, storm: -10 },
    spells: ['m_spore'], ai: 'ranged', xp: 1.1, gold: [2, 5],
    drops: [{ item: 'gloom_spore', p: 0.45 }, { item: 'gloom_hat', p: 0.06 }, { item: 'spore_pendant', p: 0.05 }, { item: 'gloom_staff', p: 0.04 }] },
  lurker: { id: 'lurker', name: 'Bog Lurker', shape: 'lurker', colors: ['#3f7f78', '#22514d'], scale: 1.1,
    hp: [18, 3.4], stat: [5, 5], agi: [5, 2], ap: 4, mp: 3, res: { physical: 5, fire: 10, storm: -10 },
    spells: ['m_drag'], ai: 'melee', xp: 1.15, gold: [2, 5],
    drops: [{ item: 'lurker_scale', p: 0.45 }, { item: 'lurker_cloak', p: 0.05 }, { item: 'mire_waders', p: 0.05 }, { item: 'reed_belt', p: 0.05 }, { item: 'bogiron_blade', p: 0.04 }] },
  wisp: { id: 'wisp', name: 'Fen Wisp', shape: 'wisp', colors: ['#9fe8ff', '#4aa3d8'], scale: 0.95,
    hp: [10, 2.6], stat: [5, 5], agi: [10, 2.5], ap: 4, mp: 3, res: { physical: 15, fire: -10, storm: 25 },
    spells: ['m_spark'], ai: 'ranged', xp: 1.15, gold: [2, 6],
    drops: [{ item: 'wisp_ember', p: 0.45 }, { item: 'wisp_ring', p: 0.05 }, { item: 'wisp_amulet', p: 0.05 }, { item: 'storm_fork', p: 0.04 }] },
  sentinel: { id: 'sentinel', name: 'Rust Sentinel', shape: 'golem', colors: ['#a0705a', '#5f4a44'], scale: 1.15,
    hp: [22, 3.2], stat: [5, 5], agi: [0, 1], ap: 6, mp: 3, res: { physical: 15, fire: 5, storm: -15 },
    spells: ['m_crush', 'm_bulwark'], ai: 'melee', xp: 1.25, gold: [3, 6],
    drops: [{ item: 'rust_plate', p: 0.45 }, { item: 'sentinel_helm', p: 0.05 }, { item: 'rustplate_belt', p: 0.05 }, { item: 'ruin_boots', p: 0.05 }, { item: 'sentinel_blade', p: 0.04 }] },
  acolyte: { id: 'acolyte', name: 'Hollow Acolyte', shape: 'acolyte', colors: ['#5a4a7a', '#c9b8ff'], scale: 1,
    hp: [14, 2.8], stat: [5, 5], agi: [5, 1.5], ap: 7, mp: 3, res: { physical: 0, fire: 15, storm: 0 },
    spells: ['m_darkflame', 'm_mend'], ai: 'support', xp: 1.25, gold: [3, 7],
    drops: [{ item: 'hollow_cloth', p: 0.45 }, { item: 'acolyte_mantle', p: 0.05 }, { item: 'hollow_sigil', p: 0.05 }, { item: 'acolyte_band', p: 0.05 }, { item: 'acolyte_staff', p: 0.04 }] },
  briarling: { id: 'briarling', name: 'Briar Thrall', shape: 'briar', colors: ['#5d7a3a', '#a33b4a'], scale: 1.05,
    hp: [22, 3.4], stat: [5, 5], agi: [5, 1.5], ap: 4, mp: 3, res: { physical: 10, fire: -15, storm: 10 },
    spells: ['m_briar'], ai: 'melee', xp: 1.3, gold: [3, 7],
    drops: [{ item: 'heartwood_shard', p: 0.25 }, { item: 'hollow_cloth', p: 0.2 }, { item: 'rust_plate', p: 0.2 }] },
  thornmaw: { id: 'thornmaw', name: 'Thornmaw, the Rootbound King', shape: 'treant', colors: ['#6b4a2e', '#8fd14f'], scale: 1.7,
    hp: [260, 10], stat: [5, 5], agi: [10, 1], ap: 10, mp: 3, res: { physical: 15, fire: -10, storm: 15 },
    spells: ['m_lash', 'm_quake', 'm_volley'], ai: 'melee', xp: 12, gold: [20, 30], boss: true,
    drops: [{ item: 'heartwood_shard', p: 1 }, { item: 'thornmaw_crown', p: 0.3 }, { item: 'rootbound_edge', p: 0.3 }, { item: 'heartwood_ring', p: 0.3 }, { item: 'kingsroot_amulet', p: 0.3 }] },
};

export const monsterXp = (def: MonsterDef, level: number) => Math.round(def.xp * (6 + 4 * Math.pow(level, 1.5)));

// ---------------------------------------------------------------- items

export type ItemType = 'weapon' | 'helm' | 'cloak' | 'amulet' | 'ring' | 'belt' | 'boots' | 'resource' | 'food';
export interface WeaponAttack { ap: number; range: [number, number]; el: Element; min: number; max: number }
export interface ItemDef {
  id: string;
  name: string;
  type: ItemType;
  level: number;
  color: string;
  price: number;
  stats?: Partial<Record<StatKey, [number, number]>>;
  attack?: WeaponAttack;
  set?: string;
  heal?: number;
  desc?: string;
}

const I = (
  id: string, name: string, type: ItemType, level: number, color: string, price: number,
  extra: Partial<ItemDef> = {},
): ItemDef => ({ id, name, type, level, color, price, ...extra });

const ITEM_LIST: ItemDef[] = [
  // Meadow
  I('twig_blade', 'Twig Blade', 'weapon', 1, '#b58c5a', 40, { stats: { str: [1, 3] }, attack: { ap: 3, range: [1, 1], el: 'physical', min: 5, max: 8 } }),
  I('thorn_wand', 'Thorn Wand', 'weapon', 3, '#b072d6', 110, { stats: { int: [2, 4] }, attack: { ap: 3, range: [1, 3], el: 'fire', min: 4, max: 7 } }),
  I('traveler_ring', "Traveler's Ring", 'ring', 1, '#c9c9c9', 35, { stats: { vit: [2, 4] } }),
  I('moss_hood', 'Mossweave Hood', 'helm', 1, '#6fae4a', 60, { stats: { vit: [3, 6], str: [1, 2] }, set: 'moss' }),
  I('moss_cape', 'Mossweave Cape', 'cloak', 2, '#6fae4a', 70, { stats: { vit: [4, 7], agi: [1, 3] }, set: 'moss' }),
  I('moss_sandals', 'Mossweave Sandals', 'boots', 3, '#6fae4a', 80, { stats: { vit: [2, 5], agi: [1, 2], init: [5, 10] }, set: 'moss' }),
  I('thistle_charm', 'Thistle Charm', 'amulet', 2, '#b072d6', 70, { stats: { int: [2, 5], vit: [2, 4] } }),
  I('sprite_band', 'Impthread Band', 'ring', 3, '#d6a0ff', 80, { stats: { agi: [2, 4], luck: [1, 3] } }),
  // Forest
  I('boar_belt', 'Boarhide Belt', 'belt', 5, '#8a6a4a', 160, { stats: { vit: [6, 10], str: [3, 5] }, set: 'boar' }),
  I('boar_boots', 'Boarhide Boots', 'boots', 7, '#8a6a4a', 200, { stats: { vit: [5, 9], str: [2, 4], agi: [2, 4] }, set: 'boar' }),
  I('boar_helm', 'Tusked Helm', 'helm', 8, '#8a6a4a', 240, { stats: { vit: [8, 12], str: [4, 7], resPhysical: [2, 4] }, set: 'boar' }),
  I('tusk_cleaver', 'Tusk Cleaver', 'weapon', 6, '#e6dcc6', 260, { stats: { str: [4, 7] }, attack: { ap: 4, range: [1, 1], el: 'physical', min: 10, max: 15 } }),
  I('bark_ring', 'Barkring', 'ring', 5, '#7a5a3a', 150, { stats: { vit: [5, 9], str: [2, 4] } }),
  I('gloom_hat', 'Gloomcap Hat', 'helm', 6, '#7c5fb0', 190, { stats: { int: [5, 8], vit: [5, 8] } }),
  I('spore_pendant', 'Spore Pendant', 'amulet', 7, '#9a7fd0', 210, { stats: { int: [4, 7], vit: [3, 6], resFire: [3, 5] } }),
  I('gloom_staff', 'Gloomwood Staff', 'weapon', 8, '#7c5fb0', 300, { stats: { int: [5, 8] }, attack: { ap: 4, range: [1, 4], el: 'fire', min: 8, max: 12 } }),
  // Marsh
  I('lurker_cloak', 'Lurkerscale Cloak', 'cloak', 11, '#3f7f78', 420, { stats: { vit: [10, 15], agi: [5, 8], resStorm: [3, 5] }, set: 'mire' }),
  I('mire_waders', 'Mire Waders', 'boots', 12, '#3f7f78', 440, { stats: { vit: [8, 13], agi: [4, 7] }, set: 'mire' }),
  I('reed_belt', 'Reedwoven Belt', 'belt', 13, '#8fae6a', 460, { stats: { vit: [8, 12], int: [4, 7], agi: [4, 7] }, set: 'mire' }),
  I('bogiron_blade', 'Bogiron Blade', 'weapon', 12, '#7f8f8a', 560, { stats: { str: [7, 11], vit: [5, 9] }, attack: { ap: 4, range: [1, 1], el: 'physical', min: 15, max: 21 } }),
  I('storm_fork', 'Stormfork', 'weapon', 14, '#7fd6ff', 620, { stats: { agi: [7, 11] }, attack: { ap: 3, range: [1, 2], el: 'storm', min: 10, max: 14 } }),
  I('wisp_ring', 'Wisplight Ring', 'ring', 12, '#9fe8ff', 430, { stats: { int: [6, 9], agi: [3, 6], crit: [1, 2] } }),
  I('wisp_amulet', 'Wisp Lantern', 'amulet', 14, '#9fe8ff', 500, { stats: { int: [8, 12], luck: [4, 7], power: [3, 6] } }),
  // Ruins
  I('sentinel_helm', 'Sentinel Helm', 'helm', 17, '#a0705a', 800, { stats: { vit: [14, 20], str: [8, 12], resPhysical: [4, 6] }, set: 'sentinel' }),
  I('rustplate_belt', 'Rustplate Girdle', 'belt', 18, '#a0705a', 820, { stats: { vit: [14, 20], resPhysical: [3, 5], resFire: [3, 5], resStorm: [3, 5] }, set: 'sentinel' }),
  I('ruin_boots', 'Ruinwalker Boots', 'boots', 18, '#a0705a', 820, { stats: { vit: [10, 16], str: [5, 9], agi: [5, 9] }, set: 'sentinel' }),
  I('sentinel_blade', 'Sentinel Greatblade', 'weapon', 19, '#c9b0a0', 1100, { stats: { str: [10, 15], power: [3, 6] }, attack: { ap: 5, range: [1, 1], el: 'physical', min: 27, max: 35 } }),
  I('acolyte_mantle', 'Acolyte Mantle', 'cloak', 19, '#5a4a7a', 900, { stats: { int: [10, 15], vit: [10, 16], power: [4, 8] } }),
  I('hollow_sigil', 'Hollow Sigil', 'amulet', 20, '#c9b8ff', 950, { stats: { int: [10, 14], str: [6, 10], dmg: [1, 2] } }),
  I('acolyte_band', "Acolyte's Band", 'ring', 18, '#c9b8ff', 850, { stats: { int: [7, 11], luck: [5, 9], crit: [1, 3] } }),
  I('acolyte_staff', 'Hollowfire Staff', 'weapon', 20, '#c9b8ff', 1150, { stats: { int: [10, 15] }, attack: { ap: 4, range: [1, 5], el: 'fire', min: 14, max: 19 } }),
  // Boss
  I('thornmaw_crown', 'Crown of Thornmaw', 'helm', 24, '#8fd14f', 3000, { stats: { vit: [20, 28], str: [10, 15], int: [10, 15], agi: [10, 15], power: [5, 10] } }),
  I('rootbound_edge', 'Rootbound Edge', 'weapon', 25, '#8fd14f', 3500, { stats: { str: [14, 20], dmg: [2, 3], crit: [2, 4] }, attack: { ap: 4, range: [1, 1], el: 'physical', min: 25, max: 33 } }),
  I('heartwood_ring', 'Heartwood Ring', 'ring', 24, '#8fd14f', 3000, { stats: { mp: [1, 1], vit: [10, 18] } }),
  I('kingsroot_amulet', 'Kingsroot Amulet', 'amulet', 25, '#8fd14f', 3500, { stats: { ap: [1, 1], vit: [10, 18] } }),
  // Resources
  I('moss_tuft', 'Moss Tuft', 'resource', 1, '#6fae4a', 8, { desc: 'Springy and damp. The quartermaster buys these.' }),
  I('sprite_dust', 'Imp Dust', 'resource', 1, '#d6a0ff', 10, { desc: 'It tickles the nose.' }),
  I('boar_tusk', 'Boar Tusk', 'resource', 5, '#e6dcc6', 28, { desc: 'Curved and heavy.' }),
  I('gloom_spore', 'Gloom Spores', 'resource', 5, '#9a7fd0', 30, { desc: 'Keep the pouch closed.' }),
  I('lurker_scale', 'Lurker Scale', 'resource', 11, '#3f7f78', 70, { desc: 'Slick, and tougher than it looks.' }),
  I('wisp_ember', 'Wisp Ember', 'resource', 11, '#9fe8ff', 76, { desc: 'Cold light that never quite goes out.' }),
  I('rust_plate', 'Rust Plate', 'resource', 17, '#a0705a', 150, { desc: 'A flake of ancient armour.' }),
  I('hollow_cloth', 'Hollow Cloth', 'resource', 17, '#5a4a7a', 160, { desc: 'Woven from something that was never thread.' }),
  I('heartwood_shard', 'Heartwood Shard', 'resource', 23, '#8fd14f', 600, { desc: 'Warm to the touch. Still growing.' }),
  // Food
  I('bread', 'Hearth Roll', 'food', 1, '#e0b070', 6, { heal: 25, desc: 'Restores 25 HP. Not usable in a fight.' }),
  I('stew', 'Fen Stew', 'food', 5, '#b0703a', 28, { heal: 80, desc: 'Restores 80 HP. Not usable in a fight.' }),
  I('draught', 'Ember Draught', 'food', 12, '#ff6b5a', 110, { heal: 220, desc: 'Restores 220 HP. Not usable in a fight.' }),
];

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(ITEM_LIST.map((i) => [i.id, i]));
export const sellPrice = (def: ItemDef) => Math.max(1, Math.floor(def.price / 4));

export interface SetDef { name: string; bonus: Record<number, Partial<Record<StatKey, number>>> }
export const SETS: Record<string, SetDef> = {
  moss: { name: 'Mossweave', bonus: { 2: { vit: 5 }, 3: { vit: 10, str: 5, int: 5, agi: 5 } } },
  boar: { name: 'Boarhide', bonus: { 2: { str: 8 }, 3: { str: 12, vit: 15, dmg: 1 } } },
  mire: { name: 'Mirewalker', bonus: { 2: { agi: 10 }, 3: { agi: 15, vit: 20, crit: 3 } } },
  sentinel: { name: 'Sentinel', bonus: { 2: { vit: 20 }, 3: { vit: 30, power: 10, resPhysical: 5 } } },
};

export const SHOP_STOCK = ['bread', 'stew', 'draught', 'twig_blade', 'thorn_wand', 'traveler_ring'];

// ---------------------------------------------------------------- maps

export type Biome = 'village' | 'meadow' | 'forest' | 'marsh' | 'ruins' | 'hollow';
export interface MapDef {
  id: string;
  name: string;
  gx: number;
  gy: number;
  biome: Biome;
  seed: number;
  levels?: [number, number];
  pool?: [string, number][];
  groups?: number;
  size?: [number, number];
  boss?: boolean;
}

export const MAPS: MapDef[] = [
  { id: 'village', name: 'Emberhollow', gx: 0, gy: 0, biome: 'village', seed: 11 },
  { id: 'meadow_w', name: 'Dewfield', gx: -1, gy: 0, biome: 'meadow', seed: 21, levels: [1, 2], pool: [['mossling', 3], ['thistle', 1]], groups: 3, size: [1, 2] },
  { id: 'meadow_s', name: 'Sunpetal Rise', gx: 0, gy: 1, biome: 'meadow', seed: 22, levels: [2, 4], pool: [['mossling', 2], ['thistle', 2]], groups: 3, size: [2, 3] },
  { id: 'meadow_e', name: 'Windrow Flats', gx: 1, gy: 0, biome: 'meadow', seed: 23, levels: [3, 5], pool: [['mossling', 2], ['thistle', 2]], groups: 3, size: [2, 4] },
  { id: 'forest_edge', name: 'Fernshade Verge', gx: 2, gy: 0, biome: 'forest', seed: 31, levels: [5, 8], pool: [['boar', 2], ['gloomcap', 2]], groups: 3, size: [2, 3] },
  { id: 'forest_deep', name: 'Oldgrowth Hush', gx: 3, gy: 0, biome: 'forest', seed: 32, levels: [8, 11], pool: [['boar', 2], ['gloomcap', 2]], groups: 3, size: [2, 4] },
  { id: 'marsh', name: 'Sallow Fen', gx: 2, gy: 1, biome: 'marsh', seed: 41, levels: [11, 14], pool: [['lurker', 2], ['wisp', 2]], groups: 3, size: [2, 3] },
  { id: 'marsh_deep', name: 'Drowned Reach', gx: 3, gy: 1, biome: 'marsh', seed: 42, levels: [14, 17], pool: [['lurker', 2], ['wisp', 2]], groups: 3, size: [2, 4] },
  { id: 'ruins', name: 'Kessari Ruins', gx: 2, gy: 2, biome: 'ruins', seed: 51, levels: [17, 22], pool: [['sentinel', 2], ['acolyte', 2]], groups: 3, size: [2, 4] },
  { id: 'hollow', name: "Thornmaw's Hollow", gx: 3, gy: 2, biome: 'hollow', seed: 61, levels: [22, 24], pool: [['briarling', 3], ['acolyte', 1]], groups: 2, size: [2, 3], boss: true },
];
export const MAP_BY_ID: Record<string, MapDef> = Object.fromEntries(MAPS.map((m) => [m.id, m]));
export const mapAt = (gx: number, gy: number) => MAPS.find((m) => m.gx === gx && m.gy === gy);
export const BOSS_LEVEL = 25;

// ---------------------------------------------------------------- quests

export interface QuestDef { name: string; text: string; target: string; count: number; xp: number; gold: number; item?: string }
export const QUESTS: QuestDef[] = [
  { name: 'Meadow Pests', text: 'Mosslings are chewing through the Dewfield crops, west of here. Thin them out.', target: 'mossling', count: 4, xp: 80, gold: 30 },
  { name: 'Thorns in the Wind', text: 'Thistle Imps pelt our shepherds with darts. Teach them some manners.', target: 'thistle', count: 5, xp: 220, gold: 60, item: 'traveler_ring' },
  { name: 'Tusk Trouble', text: 'Past Windrow Flats the forest begins. The Barkhide Boars there have grown bold.', target: 'boar', count: 6, xp: 900, gold: 150 },
  { name: 'Spore Season', text: 'Gloomcaps are seeding the Verge. Burn them out before the wind turns.', target: 'gloomcap', count: 6, xp: 1500, gold: 220 },
  { name: 'Fen Lights', text: 'South of the forest lies the Sallow Fen. Travellers follow the Wisps and do not return.', target: 'wisp', count: 6, xp: 3600, gold: 350 },
  { name: 'What Lurks', text: 'Something drags our fishers under. Bog Lurkers. Bring back fewer of them.', target: 'lurker', count: 6, xp: 4800, gold: 420 },
  { name: 'Rust and Ruin', text: 'The Kessari Ruins south of the fen still have guards. Break the Rust Sentinels.', target: 'sentinel', count: 8, xp: 9500, gold: 750 },
  { name: 'The Rootbound King', text: 'Beyond the ruins, in the Hollow, Thornmaw wakes. End it, Runeblade.', target: 'thornmaw', count: 1, xp: 22000, gold: 2500 },
];

export const LEVEL_CAP = 30;
export const xpNeed = (level: number) => 25 * level * level + 35 * level;
