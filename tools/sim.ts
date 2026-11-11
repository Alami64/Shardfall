// Plays fights through the engine without the client, to check balance.
//   npm run sim            every map, at the low and high level of its range
//   npm run sim -- 200     number of fights per line
import { ITEMS, MAPS, PLAYER_SPELLS, type ItemDef } from '../src/core/content.js';
import {
  addItem, equipItem, isGear, newCharacter, playerFighter, raiseSpell, raiseStat, weaponSpell, WEAPON_SPELL, type Character,
} from '../src/core/character.js';
import { aiTurn, createFight, current, endTurn, startFight } from '../src/core/fight.js';
import { buildMap, fightCells, monsterFighter, populate } from '../src/core/world.js';
import { createRng } from '../src/core/rng.js';

const midRng = () => 0.5;

export function buildHero(level: number, style: 'str' | 'int' = 'str'): Character {
  const ch = newCharacter('Sim', { tunic: '#000', hair: '#000', skin: '#000' });
  ch.level = level;
  ch.statPoints = (level - 1) * 5;
  ch.spellPoints = level - 1;
  const main = style;
  raiseStat(ch, main, Math.floor(ch.statPoints * 0.6));
  raiseStat(ch, 'vit', ch.statPoints);
  const el = style === 'str' ? 'physical' : 'fire';
  const order = PLAYER_SPELLS.filter((s) => s.effects.some((e) => (e.k === 'damage' && e.el === el) || e.k === 'heal'));
  for (let guard = 0; guard < 60; guard++) {
    let any = false;
    for (const s of order) any = raiseSpell(ch, s.id) || any;
    if (!any) break;
  }
  // Gear: the best piece per slot that a character of this level could have found (boss loot left out).
  const best: Record<string, ItemDef> = {};
  for (const def of Object.values(ITEMS)) {
    if (!isGear(def) || def.level > level - 1 || def.level >= 24) continue;
    if (def.type === 'weapon' && def.attack!.el !== el) continue;
    const cur = best[def.type];
    if (!cur || def.level > cur.level) best[def.type] = def;
  }
  for (const def of Object.values(best)) equipItem(ch, addItem(ch, def.id, 1, midRng).uid);
  ch.hp = 9999;
  return ch;
}

function runFight(mapId: string, level: number, seed: number, style: 'str' | 'int') {
  const rng = createRng(seed);
  const map = buildMap(MAPS.find((m) => m.id === mapId)!);
  populate(map, rng);
  const group = map.groups[Math.floor(rng() * map.groups.length)]!;
  const ch = buildHero(level, style);
  const cells = fightCells(map, group, map.spawn, rng);
  const hero = playerFighter(ch, cells.player[0]!);
  if (style === 'int') hero.ai = 'ranged';
  const fighters = [hero, ...group.members.map((m, i) => monsterFighter(m.def, m.level, cells.monsters[i] ?? cells.monsters[0]!))];
  const st = createFight(fighters, map.walkable, map.opaque, { [WEAPON_SPELL]: weaponSpell(ch) });
  startFight(st);
  for (let guard = 0; guard < 400 && !st.over; guard++) {
    aiTurn(st, current(st), rng);
    if (!st.over) endTurn(st);
  }
  return { win: st.over === 'win', hp: hero.hp / hero.maxHp, rounds: st.round, size: group.members.length, boss: !!group.boss };
}

const N = Number(process.argv[2]) || 150;
console.log('map            lvl build  size  win%  hp left  rounds');
for (const m of MAPS) {
  if (!m.levels) continue;
  const levels = m.boss ? [m.levels[1] + 1, m.levels[1] + 4] : [m.levels[0], m.levels[1]];
  for (const level of levels) {
    for (const style of ['str', 'int'] as const) {
      const bySize = new Map<string, { n: number; win: number; hp: number; rounds: number }>();
      for (let k = 0; k < N; k++) {
        const r = runFight(m.id, level, 1000 + k * 13 + level, style);
        const key = r.boss ? 'boss' : String(r.size);
        const s = bySize.get(key) ?? { n: 0, win: 0, hp: 0, rounds: 0 };
        s.n++; s.rounds += r.rounds;
        if (r.win) { s.win++; s.hp += r.hp; }
        bySize.set(key, s);
      }
      for (const [size, s] of [...bySize].sort()) {
        console.log(
          `${m.id.padEnd(14)} ${String(level).padStart(3)} ${style}   ${size.padStart(4)}  ${String(Math.round((100 * s.win) / s.n)).padStart(4)}  ${
            s.win ? String(Math.round((100 * s.hp) / s.win)).padStart(6) + '%' : '      -'
          }  ${(s.rounds / s.n).toFixed(1).padStart(6)}`,
        );
      }
    }
  }
}
