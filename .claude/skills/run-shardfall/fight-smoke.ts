/**
 * Plays fights through the real fight engine (packages/shared) with the built
 * content, every fighter driven by the monster AI (playAiTurn). Prints a
 * turn-by-turn log, or one line per seed.
 *
 *   npx tsx .claude/skills/run-shardfall/fight-smoke.ts                 # meadow battle, seed 7, full log
 *   npx tsx .claude/skills/run-shardfall/fight-smoke.ts 3 duel          # Vanguard vs Longshot, seed 3
 *   npx tsx .claude/skills/run-shardfall/fight-smoke.ts 1-20 meadow     # 20 fights: winner and length, then a tally
 *
 * Scenarios: `meadow` = Vanguard, Longshot and Mender against two Thornback Boars and a Dewdrop Wisp;
 * `duel` = Vanguard against Longshot. The client does not run fights yet, so this is how to see
 * engine, content and AI changes play out.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../../../packages/shared/src/index.ts';
import type { FightEvent, FightState, MonsterCatalogue, SpellCatalogue, WorldData } from '../../../packages/shared/src/index.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const world = JSON.parse(readFileSync(`${ROOT}/content/maps/built/world.json`, 'utf8')) as WorldData;
const { spells } = JSON.parse(readFileSync(`${ROOT}/content/spells/built/spells.json`, 'utf8')) as SpellCatalogue;
const { monsters } = JSON.parse(readFileSync(`${ROOT}/content/monsters/built/monsters.json`, 'utf8')) as MonsterCatalogue;
const map = world.maps.find((m) => m.id === 'brightmoor_0_0')!;
const LEVEL = 6; // all three spell pairs unlocked
const kit = (cls: string) => spells.filter((s) => s.classId === cls).map((s) => ({ spellId: s.id, grade: 1 }));
const hp = S.characterMaxHp(LEVEL, 0);
const hero = (id: string, ai: S.AiProfile, stats: Partial<S.FighterStats>): S.FighterSetup => ({
  id,
  name: id,
  team: 'A',
  controller: 'player',
  ai, // the AI stands in for the player
  spells: kit(id.toLowerCase()),
  stats: S.fighterStats({ level: LEVEL, maxHp: hp, ...stats }),
});
const vanguard = hero('Vanguard', { archetype: 'brute', preferredRange: 1 }, { strength: 30, agility: 10, initiative: 10 });
const longshot = hero('Longshot', { archetype: 'caster', preferredRange: 5 }, { agility: 30, intelligence: 10 });
const mender = hero('Mender', { archetype: 'caster', preferredRange: 4 }, { intelligence: 30, chance: 10 });
const monster = (id: string) => monsters.find((m) => m.id === id)!;

// The test maps have no start cells flagged yet, so each scenario names its own (walkable cells on the meadow).
const SCENARIOS: Record<string, { setups: S.FighterSetup[]; startCells: Record<S.Team, number[]> }> = {
  meadow: {
    setups: [
      vanguard,
      longshot,
      mender,
      S.monsterSetup(monster('thornback_boar'), 1, 'Boar1', 'B'),
      S.monsterSetup(monster('thornback_boar'), 2, 'Boar2', 'B'),
      S.monsterSetup(monster('dewdrop_wisp'), 2, 'Wisp', 'B'),
    ],
    startCells: { A: [339, 325, 353], B: [316, 302, 330] },
  },
  duel: {
    setups: [vanguard, { ...longshot, team: 'B' }],
    startCells: { A: [339], B: [315] },
  },
};

const g = (c: number) => {
  const p = S.cellToGrid(c);
  return `(${p.x},${p.y})`;
};
function describe(e: FightEvent): string | null {
  switch (e.type) {
    case 'turnStarted': return `\n-- round ${e.round}: ${e.fighterId}`;
    case 'moved': return `   walks to ${g(e.path.at(-1)!)} (${e.path.length} MP)`;
    case 'tackled': return `   tackled: loses ${e.mpLost} MP, ${e.apLost} AP`;
    case 'spellCast': return `   casts ${e.spellId} on ${g(e.cell)}${e.critical ? ' CRITICAL' : ''}`;
    case 'damaged': return `     ${e.fighterId} takes ${e.amount} -> ${e.hp} HP`;
    case 'healed': return `     ${e.fighterId} heals ${e.amount} -> ${e.hp} HP`;
    case 'shieldHit': return `     ${e.fighterId}'s shield absorbs ${e.absorbed}`;
    case 'displaced': return `     ${e.fighterId} ${e.reason} to ${g(e.path.at(-1)!)}`;
    case 'buffAdded': {
      const b = e.buff;
      const what = b.kind === 'stat' || b.kind === 'elementStat' ? `${b.value > 0 ? '+' : ''}${b.value} ${b.stat}` : b.kind;
      return `     ${e.fighterId} gets ${what} (${b.remaining} turns)`;
    }
    case 'pointsRemoved': return `     ${e.fighterId} loses ${e.removed} ${e.points.toUpperCase()} (${e.dodged} dodged)`;
    case 'pointsChanged': return `     ${e.fighterId} ${e.amount >= 0 ? '+' : ''}${e.amount} ${e.points.toUpperCase()} now`;
    case 'revived': return `     ${e.fighterId} revived at ${e.hp} HP`;
    case 'died': return `     ${e.fighterId} dies`;
    case 'fightEnded': return `\n== ${e.winner === null ? 'draw' : `team ${e.winner} wins`} ==`;
    default: return null;
  }
}

function fight(scenario: string, seed: number, log: boolean): { winner: S.Team | null; rounds: number; ms: number } {
  const { setups, startCells } = SCENARIOS[scenario] ?? SCENARIOS.meadow!;
  const rng = S.createRng(seed);
  const print = (events: FightEvent[]) => {
    if (!log) return;
    for (const e of events) {
      const line = describe(e);
      if (line) console.log(line);
    }
  };
  const created = S.createFight(map, setups, rng, { startCells, spells });
  if (!created.ok) throw new Error(created.error);
  const started = S.startFight(created.state, rng);
  if (!started.ok) throw new Error(started.error);
  let state: FightState = started.state;
  if (log) {
    console.log(`seed ${seed}, ${scenario}: ${state.fighters.map((f) => `${f.name} (${f.team}) at ${g(f.cell)}`).join(', ')}`);
    console.log(`turn order: ${state.turnOrder.join(', ')}`);
  }
  print(started.events);

  let ms = 0;
  let turns = 0;
  while (state.phase === 'fighting' && turns < 300) {
    const t0 = performance.now();
    const r = S.playAiTurn(state, S.activeFighter(state)!.id, rng);
    ms += performance.now() - t0;
    turns++;
    if (!r.ok) throw new Error(r.error);
    state = r.state;
    print(r.events);
  }
  return { winner: state.winner, rounds: state.round, ms: ms / turns };
}

const [arg = '7', scenario = 'meadow'] = process.argv.slice(2);
const range = arg.match(/^(\d+)-(\d+)$/);
const teamName = (t: S.Team | null) => (t === null ? 'draw' : t === 'A' ? 'heroes' : scenario === 'duel' ? 'Longshot' : 'monsters');
if (range) {
  const tally: Record<string, number> = {};
  for (let seed = Number(range[1]); seed <= Number(range[2]); seed++) {
    const { winner, rounds, ms } = fight(scenario, seed, false);
    tally[teamName(winner)] = (tally[teamName(winner)] ?? 0) + 1;
    console.log(`seed ${seed}: ${teamName(winner)} win in round ${rounds} (AI ${ms.toFixed(1)} ms per turn)`);
  }
  console.log(JSON.stringify(tally));
} else {
  const { ms } = fight(scenario, Number(arg), true);
  console.log(`(AI ${ms.toFixed(1)} ms per turn on average)`);
}
