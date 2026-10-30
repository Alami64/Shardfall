/**
 * Plays fights through the real fight engine (packages/shared) with the built
 * content, every fighter driven by the monster AI (playAiTurn). Prints a
 * turn-by-turn log, or one line per seed.
 *
 *   npx tsx .claude/skills/run-shardfall/fight-smoke.ts                  # meadow battle, seed 7, full log
 *   npx tsx .claude/skills/run-shardfall/fight-smoke.ts 3 duel           # Vanguard vs Longshot, seed 3
 *   npx tsx .claude/skills/run-shardfall/fight-smoke.ts 1-20 meadow      # 20 fights: winner and length, then a tally
 *   npx tsx .claude/skills/run-shardfall/fight-smoke.ts 1-20 deep 48     # the same at another party level
 *
 * Scenarios: one per client encounter (packages/client/src/fight/setup.ts), each at the party level
 * it is meant for: `meadow` (6), `patrol` (18) and `yard` (28) in Gildhaven Outskirts, `hunt` (40)
 * and `deep` (58) on Thornwild Edge. `duel` = Vanguard against Longshot at level 6. Heroes use
 * their default loadout (the first spell of every unlocked pair).
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
const monster = (id: string) => monsters.find((m) => m.id === id)!;

interface Scenario {
  mapId: string;
  level: number;
  /** Monster id and grade, as in the client's encounter. */
  group: [string, number][];
}

const SCENARIOS: Record<string, Scenario> = {
  meadow: { mapId: 'brightmoor_0_0', level: 6, group: [['thornback_boar', 2], ['thornback_boar', 3], ['dewdrop_wisp', 2]] },
  patrol: { mapId: 'gildhaven_0_0', level: 18, group: [['rustpike_sentry', 3], ['rustpike_sentry', 2], ['coinmoth', 2]] },
  yard: { mapId: 'gildhaven_0_0', level: 28, group: [['rustpike_sentry', 5], ['rustpike_sentry', 4], ['coinmoth', 5]] },
  hunt: { mapId: 'thornwild_0_0', level: 40, group: [['bramble_stalker', 3], ['bramble_stalker', 2], ['mirecap', 2]] },
  deep: { mapId: 'thornwild_0_0', level: 58, group: [['bramble_stalker', 5], ['bramble_stalker', 4], ['mirecap', 4]] },
};

/** The fighters and start cells of a scenario, at the party level given (or the scenario's own). */
function lineUp(name: string, level?: number): { map: S.GameMap; setups: S.FighterSetup[]; startCells: Record<S.Team, number[]> } {
  const meadow = world.maps.find((m) => m.id === 'brightmoor_0_0')!;
  const hero = (classId: string, lvl: number) => S.heroSetup(classId, spells, { level: lvl });
  if (name === 'duel') {
    const lvl = level ?? 6;
    return { map: meadow, setups: [hero('vanguard', lvl), { ...hero('longshot', lvl), team: 'B' }], startCells: { A: [339], B: [315] } };
  }
  const sc = SCENARIOS[name] ?? SCENARIOS.meadow!;
  const map = world.maps.find((m) => m.id === sc.mapId)!;
  const lvl = level ?? sc.level;
  const counts = new Map<string, number>();
  const group = sc.group.map(([id, grade]) => {
    const n = (counts.get(id) ?? 0) + 1;
    counts.set(id, n);
    return S.monsterSetup(monster(id), grade, `${id}_${n}`, 'B');
  });
  return { map, setups: [...S.CLASS_BUILDS.map((b) => hero(b.classId, lvl)), ...group], startCells: S.mapStartCells(map) };
}

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
    case 'dotTicked': return `     ${e.fighterId} burns (${e.spellId})`;
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

function fight(scenario: string, seed: number, log: boolean, level?: number): { winner: S.Team | null; rounds: number; ms: number } {
  const { map, setups, startCells } = lineUp(scenario, level);
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

const [arg = '7', scenario = 'meadow', levelArg] = process.argv.slice(2);
const level = levelArg ? Number(levelArg) : undefined;
const range = arg.match(/^(\d+)-(\d+)$/);
const teamName = (t: S.Team | null) => (t === null ? 'draw' : t === 'A' ? 'heroes' : scenario === 'duel' ? 'Longshot' : 'monsters');
if (range) {
  const tally: Record<string, number> = {};
  for (let seed = Number(range[1]); seed <= Number(range[2]); seed++) {
    const { winner, rounds, ms } = fight(scenario, seed, false, level);
    tally[teamName(winner)] = (tally[teamName(winner)] ?? 0) + 1;
    console.log(`seed ${seed}: ${teamName(winner)} win in round ${rounds} (AI ${ms.toFixed(1)} ms per turn)`);
  }
  console.log(JSON.stringify(tally));
} else {
  const { ms } = fight(scenario, Number(arg), true, level);
  console.log(`(AI ${ms.toFixed(1)} ms per turn on average)`);
}
