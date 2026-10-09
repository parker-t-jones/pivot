import { describe, expect, it } from 'vitest';
import {
  resolveOpponentStakeSlots,
  opponentStakesFor,
  type OpponentStakeSlot,
} from './opponentStakes.js';
import { diffRosteredSet, type StoredRosteredStake } from './rosteredStakes.js';

const USER = 'user-1';
const LEAGUE = 'league-a';
const PHI = 'team-phi';
const CHI = 'team-chi';
const BYE = 'team-bye';

function slot(overrides: Partial<OpponentStakeSlot> = {}): OpponentStakeSlot {
  return {
    playerId: 'player-wr',
    teamId: PHI,
    position: 'WR',
    slotType: 'starter',
    positionInLineup: 'WR',
    ...overrides,
  };
}

function rowsFor(slots: readonly OpponentStakeSlot[]) {
  return opponentStakesFor(slots, {
    userId: USER,
    season: 2026,
    week: 5,
    leagueId: LEAGUE,
    gameIdByTeamId: new Map([
      [PHI, 'game-phi'],
      [CHI, 'game-chi'],
    ]),
  });
}

describe('opponentStakesFor', () => {
  it('stores starter and flex rows at half weight for the league', () => {
    const rows = rowsFor([
      slot({ playerId: 'wr', position: 'WR' }),
      slot({ playerId: 'flex', position: 'RB', slotType: 'flex' }),
      slot({ playerId: 'bench', slotType: 'bench' }),
    ]);

    expect(rows.map((row) => row.subject.playerId)).toEqual(['wr', 'flex']);
    expect(rows.every((row) => row.condition.type === 'OPPONENT_ROSTERED')).toBe(true);
    expect(rows.every((row) => row.source === 'SLEEPER_OPPONENT' && row.sourceRef === LEAGUE)).toBe(
      true,
    );
    expect(rows.every((row) => row.weight === 0.5 && row.gameId === 'game-phi')).toBe(true);
  });

  it('skips a bye-week player who has no regular-season game', () => {
    const rows = rowsFor([
      slot({ playerId: 'on-bye', teamId: BYE }),
      slot({ playerId: 'playing', teamId: PHI }),
    ]);
    expect(rows.map((row) => row.subject.playerId)).toEqual(['playing']);
  });

  it('keeps a defense the same way as any other player', () => {
    const rows = rowsFor([
      slot({ playerId: 'phi-def', teamId: PHI, position: 'DEF', positionInLineup: 'DEF' }),
    ]);
    expect(rows).toEqual([
      {
        userId: USER,
        season: 2026,
        week: 5,
        gameId: 'game-phi',
        subject: { type: 'PLAYER', playerId: 'phi-def', teamId: PHI },
        condition: { type: 'OPPONENT_ROSTERED' },
        source: 'SLEEPER_OPPONENT',
        sourceRef: LEAGUE,
        weight: 0.5,
        slotLabel: 'DEF',
        slotIndex: 0,
      },
    ]);
  });
});

describe('resolveOpponentStakeSlots', () => {
  it('drops a starter missing from players and reports that id', () => {
    const resolved = resolveOpponentStakeSlots(
      [
        { externalPlayerId: 'sl-wr', slotType: 'starter', positionInLineup: 'WR' },
        { externalPlayerId: 'sl-missing', slotType: 'flex', positionInLineup: 'FLEX' },
        { externalPlayerId: 'sl-bench', slotType: 'bench', positionInLineup: 'BN' },
      ],
      new Map([['sl-wr', { id: 'wr', team_id: PHI, position: 'WR' }]]),
    );
    expect(resolved.unresolvedIds).toEqual(['sl-missing']);
    expect(resolved.slots).toEqual([
      {
        playerId: 'wr',
        teamId: PHI,
        position: 'WR',
        slotType: 'starter',
        positionInLineup: 'WR',
      },
    ]);
  });
});

describe('opponent set replace', () => {
  it('adds, removes, and swaps players inside the opponent set', () => {
    const stored: StoredRosteredStake[] = [
      { id: 'id-a', playerId: 'a', teamId: PHI, gameId: 'game-phi' },
      { id: 'id-b', playerId: 'b', teamId: PHI, gameId: 'game-phi' },
    ];
    const next = rowsFor([
      slot({ playerId: 'b', teamId: CHI }),
      slot({ playerId: 'c', teamId: PHI }),
    ]);
    const diff = diffRosteredSet(stored, next);

    expect(diff.deleteIds).toEqual(['id-a']);
    expect(diff.inserts.map((row) => row.subject.playerId)).toEqual(['c']);
    expect(diff.inserts.every((row) => row.condition.type === 'OPPONENT_ROSTERED')).toBe(true);
    expect(diff.updates).toEqual([
      {
        id: 'id-b',
        gameId: 'game-chi',
        subject: { type: 'PLAYER', playerId: 'b', teamId: CHI },
        slotLabel: 'WR',
        slotIndex: 0,
      },
    ]);
  });

  it('copies slot_label and the starter index from the opponent slots', () => {
    const rows = rowsFor([
      slot({ playerId: 'rb1', positionInLineup: 'RB1' }),
      slot({ playerId: 'flex', position: 'WR', slotType: 'flex', positionInLineup: 'FLEX' }),
    ]);
    expect(
      rows.map((row) => ({
        playerId: row.subject.playerId,
        slotLabel: row.slotLabel,
        slotIndex: row.slotIndex,
      })),
    ).toEqual([
      { playerId: 'rb1', slotLabel: 'RB1', slotIndex: 0 },
      { playerId: 'flex', slotLabel: 'FLEX', slotIndex: 1 },
    ]);
  });

  it('updates both rows when RB1 and RB2 swap slots', () => {
    const stored: StoredRosteredStake[] = [
      {
        id: 'id-a',
        playerId: 'a',
        teamId: PHI,
        gameId: 'game-phi',
        slotLabel: 'RB1',
        slotIndex: 0,
      },
      {
        id: 'id-b',
        playerId: 'b',
        teamId: PHI,
        gameId: 'game-phi',
        slotLabel: 'RB2',
        slotIndex: 1,
      },
    ];
    const next = rowsFor([
      slot({ playerId: 'b', positionInLineup: 'RB1' }),
      slot({ playerId: 'a', positionInLineup: 'RB2' }),
    ]);
    const diff = diffRosteredSet(stored, next);

    expect(diff.deleteIds).toEqual([]);
    expect(diff.inserts).toEqual([]);
    expect(diff.updates).toEqual([
      {
        id: 'id-b',
        gameId: 'game-phi',
        subject: { type: 'PLAYER', playerId: 'b', teamId: PHI },
        slotLabel: 'RB1',
        slotIndex: 0,
      },
      {
        id: 'id-a',
        gameId: 'game-phi',
        subject: { type: 'PLAYER', playerId: 'a', teamId: PHI },
        slotLabel: 'RB2',
        slotIndex: 1,
      },
    ]);
  });

  it('deletes the whole set when the next list is empty', () => {
    const stored: StoredRosteredStake[] = [
      { id: 'id-a', playerId: 'a', teamId: PHI, gameId: 'game-phi' },
    ];
    expect(diffRosteredSet(stored, rowsFor([])).deleteIds).toEqual(['id-a']);
  });
});
