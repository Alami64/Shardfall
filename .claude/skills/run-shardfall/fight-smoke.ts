/**
 * Plays fights through the real fight engine (packages/shared) with the built
 * spell content, using a naive controller: cast any spell that can hit the
 * enemy (and the few self-buffs), else take one step towards a preferred
 * distance, repeat, end turn. Prints a turn-by-turn log, or one line per seed.
 *
 *   npx tsx .claude/skills/run-shardfall/fight-smoke.ts            # one fight, full log (seed 7)
 *   npx tsx .claude/skills/run-shardfall/fight-smoke.ts 3          # seed 3
 *   npx tsx .claude/skills/run-shardfall/fight-smoke.ts 1-20       # 20 fights, winner and length only
 *
 * The client does not run fights yet, so this is how to see engine changes play out.
 * The controller is not the monster AI; it plays badly, so read balance results loosely.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../../../packages/shared/src/index.ts';
import type { FightEvent, FightResult, FightState, SpellCatalogue, WorldData } from '../../../packages/shared/src/index.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const world = JSON.parse(readFileSync(`${ROOT}/content/maps/built/world.json`, 'utf8')) as WorldData;
const { spells } = JSON.parse(readFileSync(`${ROOT}/content/spells/built/spells.json`, 'utf8')) as SpellCatalogue;
const map = world.maps.find((m) => m.id === 'brightmoor_0_0')!;
const LEVEL = 6; // all three spell pairs unlocked
const SELF_BUFFS = new Set(['rally', 'brace', 'eagle_eye']);

const kit = (cls: string) => spells.filter((s) => s.classId === cls).map((s) => ({ spellId: s.id, grade: 1 }));
const hp = S.characterMaxHp(LEVEL, 0);
const setups: S.FighterSetup[] = [
  {
    id: 'Vanguard',
    name: 'Vanguard',
    team: 'A',
    controller: 'player',
    spells: kit('vanguard'),
    stats: S.fighterStats({ level: LEVEL, maxHp: hp, strength: 30, agility: 10, initiative: 10 }),
  },
  {
    id: 'Longshot',
    name: 'Longshot',
    team: 'B',
    controller: 'ai',
    spells: kit('longshot'),
    stats: S.fighterStats({ level: LEVEL, maxHp: hp, agility: 30, intelligence: 10 }),
  },
];
/** Preferred distance to the enemy for each fighter's naive movement. */
const PREFERRED: Record<string, number> = { Vanguard: 1, Longshot: 5 };

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

function fight(seed: number, log: boolean): { winner: S.Team | null; rounds: number } {
  const rng = S.createRng(seed);
  let state: FightState;
  const apply = (r: FightResult) => {
    if (!r.ok) return false;
    state = r.state;
    if (log) for (const e of r.events) {
      const line = describe(e);
      if (line) console.log(line);
    }
    return true;
  };
  // The test maps have no start cells flagged yet: two cells on the dirt path, 8 apart.
  const created = S.createFight(map, setups, rng, { startCells: { A: [339], B: [315] }, spells });
  if (!created.ok) throw new Error(created.error);
  state = created.state;
  if (log) console.log(`seed ${seed}: Vanguard at ${g(339)} vs Longshot at ${g(315)}, level ${LEVEL}, ${hp} HP each`);
  apply(S.startFight(state, rng));

  for (let turn = 0; turn < 60 && state.phase === 'fighting'; turn++) {
    const me = S.activeFighter(state)!.id;
    const foeId = state.fighters.find((f) => f.id !== me)!.id;
    for (let guard = 0; guard < 20 && S.activeFighter(state)?.id === me; guard++) {
      const f = S.getFighter(state, me)!;
      const foe = S.getFighter(state, foeId)!;
      const cast = f.spells.find(({ spellId }) =>
        SELF_BUFFS.has(spellId)
          ? S.castError(state, me, spellId, f.cell) === null
          : S.castError(state, me, spellId, foe.cell) === null,
      );
      if (cast) {
        apply(S.castSpell(state, me, cast.spellId, SELF_BUFFS.has(cast.spellId) ? f.cell : foe.cell, rng));
        continue;
      }
      const off = (c: number) => Math.abs(S.distance(c, foe.cell) - PREFERRED[me]!);
      const step = [...S.movementRange(state, me)].filter(([, cost]) => cost === 1).map(([c]) => c).sort((a, b) => off(a) - off(b))[0];
      if (step === undefined || off(step) >= off(f.cell) || !apply(S.moveFighter(state, me, [step]))) break;
    }
    if (S.activeFighter(state)?.id === me) apply(S.endTurn(state, me));
  }
  return { winner: state.winner, rounds: state.round };
}

const arg = process.argv[2] ?? '7';
const range = arg.match(/^(\d+)-(\d+)$/);
if (range) {
  const tally: Record<string, number> = {};
  for (let seed = Number(range[1]); seed <= Number(range[2]); seed++) {
    const { winner, rounds } = fight(seed, false);
    const who = winner === null ? 'draw' : winner === 'A' ? 'Vanguard' : 'Longshot';
    tally[who] = (tally[who] ?? 0) + 1;
    console.log(`seed ${seed}: ${who} wins in round ${rounds}`);
  }
  console.log(JSON.stringify(tally));
} else {
  fight(Number(arg), true);
}
