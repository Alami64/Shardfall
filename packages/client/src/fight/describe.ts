/** Words for fight events and errors: log lines, floating text over the board, error toasts. */
import type { Buff, FightError, FightEvent, FightState } from '@shardfall/shared';
import { spells } from '../assets';

export const STAT_LABELS: Record<string, string> = {
  ap: 'AP',
  mp: 'MP',
  range: 'Range',
  initiative: 'Initiative',
  strength: 'Strength',
  intelligence: 'Intelligence',
  chance: 'Chance',
  agility: 'Agility',
  power: 'Power',
  criticalChance: 'Critical %',
  criticalDamage: 'Critical damage',
  heals: 'Heals',
  dodge: 'Dodge',
  lock: 'Lock',
  apParry: 'AP parry',
  mpParry: 'MP parry',
  apRemoval: 'AP removal',
  mpRemoval: 'MP removal',
  damage: 'damage',
  resistPercent: '% resistance',
  resistFlat: 'resistance',
};

export const spellName = (id: string) => spells.find((s) => s.id === id)?.name ?? id;

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "+20% resistance", "-2 MP", "Shield 15", "Rooted", "6 Fire per turn". */
export function buffLabel(b: Buff): string {
  switch (b.kind) {
    case 'shield':
      return `Shield ${b.value}`;
    case 'dot':
      return `${b.value} ${capital(b.element)} per turn`;
    case 'state':
      return capital(b.state);
    case 'stat':
    case 'elementStat': {
      const sign = b.value > 0 ? '+' : '';
      const element = b.kind === 'elementStat' && b.element !== 'all' ? ` ${b.element}` : '';
      const label = STAT_LABELS[b.stat] ?? b.stat;
      return b.stat === 'resistPercent' ? `${sign}${b.value}%${element} resistance` : `${sign}${b.value}${element} ${label}`;
    }
  }
}

const turns = (n: number) => (n === 1 ? '1 turn' : `${n} turns`);

export interface EventText {
  log?: { line: string; kind: 'turn' | 'hit' | 'heal' | 'info' };
  /** Text to float over a fighter. */
  float?: { fighterId: string; text: string; color: string };
}

export const FLOAT_COLORS = {
  damage: '#ff8a70',
  heal: '#8ee68a',
  points: '#7cc4ff',
  buff: '#f6d77a',
  info: '#fff6dc',
} as const;

/** The log line and floating text for an event, read against the state the events led to. */
export function describeEvent(e: FightEvent, state: FightState): EventText {
  const name = (id: string) => state.fighters.find((f) => f.id === id)?.name ?? id;
  switch (e.type) {
    case 'fightStarted':
      return { log: { line: 'The fight begins.', kind: 'info' } };
    case 'turnStarted':
      return { log: { line: `Round ${e.round} · ${name(e.fighterId)}`, kind: 'turn' } };
    case 'moved':
      return {};
    case 'tackled':
      return {
        log: { line: `${name(e.fighterId)} is tackled: -${e.mpLost} MP, -${e.apLost} AP.`, kind: 'info' },
        float: { fighterId: e.fighterId, text: `Tackled -${e.mpLost} MP`, color: FLOAT_COLORS.points },
      };
    case 'spellCast':
      return {
        log: { line: `${name(e.fighterId)} casts ${spellName(e.spellId)}${e.critical ? ' (critical!)' : ''}.`, kind: 'info' },
        float: { fighterId: e.fighterId, text: e.critical ? `${spellName(e.spellId)}!` : spellName(e.spellId), color: FLOAT_COLORS.info },
      };
    case 'damaged':
      return {
        log: { line: `${name(e.fighterId)} takes ${e.amount} damage (${e.hp} HP left).`, kind: 'hit' },
        float: { fighterId: e.fighterId, text: `-${e.amount}`, color: FLOAT_COLORS.damage },
      };
    case 'dotTicked':
      return { log: { line: `${spellName(e.spellId)} hurts ${name(e.fighterId)}.`, kind: 'hit' } };
    case 'shieldHit':
      return {
        log: { line: `${name(e.fighterId)}'s shield absorbs ${e.absorbed}.`, kind: 'info' },
        float: { fighterId: e.fighterId, text: `(${e.absorbed})`, color: FLOAT_COLORS.points },
      };
    case 'healed':
      return {
        log: { line: `${name(e.fighterId)} heals ${e.amount} (${e.hp} HP).`, kind: 'heal' },
        float: { fighterId: e.fighterId, text: `+${e.amount}`, color: FLOAT_COLORS.heal },
      };
    case 'displaced':
      return { log: { line: `${name(e.fighterId)} is ${pastTense[e.reason]}.`, kind: 'info' } };
    case 'pointsRemoved':
      return {
        log: {
          line: `${name(e.fighterId)} loses ${e.removed} ${e.points.toUpperCase()}${e.dodged ? ` (dodges ${e.dodged})` : ''}.`,
          kind: 'info',
        },
        float: {
          fighterId: e.fighterId,
          text: e.removed ? `-${e.removed} ${e.points.toUpperCase()}` : 'Dodged',
          color: FLOAT_COLORS.points,
        },
      };
    case 'pointsChanged':
      if (e.amount === 0) return {};
      return {
        float: {
          fighterId: e.fighterId,
          text: `${e.amount > 0 ? '+' : ''}${e.amount} ${e.points.toUpperCase()}`,
          color: FLOAT_COLORS.points,
        },
      };
    case 'buffAdded':
      return {
        log: { line: `${name(e.fighterId)}: ${buffLabel(e.buff)} for ${turns(e.buff.remaining)}.`, kind: 'info' },
        float: { fighterId: e.fighterId, text: buffLabel(e.buff), color: FLOAT_COLORS.buff },
      };
    case 'buffExpired':
      return {};
    case 'revived':
      return {
        log: { line: `${name(e.fighterId)} is revived with ${e.hp} HP!`, kind: 'heal' },
        float: { fighterId: e.fighterId, text: 'Revived', color: FLOAT_COLORS.heal },
      };
    case 'died':
      return { log: { line: `${name(e.fighterId)} falls.`, kind: 'hit' } };
    case 'fled':
      return { log: { line: `${name(e.fighterId)} flees the fight.`, kind: 'info' } };
    case 'fightEnded':
      return { log: { line: e.winner === 'A' ? 'Victory!' : e.winner === 'B' ? 'Defeat.' : 'Draw.', kind: 'turn' } };
    default:
      return {};
  }
}

const pastTense = { push: 'pushed back', pull: 'pulled in', teleport: 'teleported', swap: 'swapped' } as const;

const ERRORS: Record<FightError, string> = {
  'wrong-phase': 'Not now',
  'duplicate-fighter': 'Already in the fight',
  'unknown-fighter': 'Unknown fighter',
  'no-free-start-cell': 'No free start cell',
  'not-a-start-cell': 'Pick one of your start cells',
  'missing-team': 'Both teams need a fighter',
  'not-your-turn': 'Not your turn',
  'not-alive': 'That fighter is down',
  'cannot-flee': 'Cannot flee',
  'empty-path': 'Already there',
  'invalid-path': 'Cannot walk there',
  'cell-occupied': 'That cell is taken',
  'not-enough-mp': 'Not enough MP',
  'unknown-spell': 'Unknown spell',
  'not-enough-ap': 'Not enough AP',
  'on-cooldown': 'Not ready yet',
  'cast-limit': 'No more casts this turn',
  'target-limit': 'No more casts on that target this turn',
  'invalid-target': 'Cannot target that cell',
  'out-of-range': 'Out of range',
  'not-in-line': 'Must be in a straight line',
  'no-line-of-sight': 'No line of sight',
};

export const errorText = (error: FightError) => ERRORS[error];
