import { describe, expect, it, vi } from 'vitest';
import {
  diffRosteredSet,
  gameIdByTeam,
  rosteredStakesFor,
  type RosteredStakeInsert,
  type RosteredStakeSlot,
  type RosteredStakesContext,
  type StoredRosteredStake,
} from './rosteredStakes.js';

const USER = 'user-1';
const PHI = 'team-phi';
const CHI = 'team-chi';
const BYE = 'team-bye';
const LEAGUE_A = 'league-a';
const LEAGUE_B = 'league-b';

function ctx(
  games: Record<string, string> = { [PHI]: 'game-phi', [CHI]: 'game-chi' },
): RosteredStakesContext {
  return {
    userId: USER,
    season: 2026,
    week: 5,
    gameIdByTeamId: new Map(Object.entries(games)),
  };
}

function slot(overrides: Partial<RosteredStakeSlot> = {}): RosteredStakeSlot {
  return {
    playerId: 'player-wr',
    teamId: PHI,
    position: 'WR',
    slotType: 'starter',
    leagueId: LEAGUE_A,
    platform: 'sleeper',
    ...overrides,
  };
}

describe('rosteredStakesFor', () => {
  it('keeps starter and flex slots and skips bench and idp', () => {
    const rows = rosteredStakesFor(
      [
        slot({ playerId: 'starter', slotType: 'starter' }),
        slot({ playerId: 'flex', slotType: 'flex', position: 'RB' }),
        slot({ playerId: 'bench', slotType: 'bench', position: 'QB' }),
        slot({ playerId: 'idp', slotType: 'idp', position: 'LB' }),
      ],
      ctx(),
    );

    expect(rows.map((row) => row.subject.playerId)).toEqual(['starter', 'flex']);
    expect(rows.every((row) => row.condition.type === 'ROSTERED' && row.weight === 1)).toBe(true);
    expect(rows.every((row) => row.source === 'SLEEPER_ROSTER' && row.sourceRef === LEAGUE_A)).toBe(
      true,
    );
    expect(rows.every((row) => !('slotLabel' in row) && !('slotIndex' in row))).toBe(true);
  });

  it('skips a bye-week player who has no game', () => {
    const rows = rosteredStakesFor(
      [slot({ playerId: 'on-bye', teamId: BYE }), slot({ playerId: 'playing', teamId: PHI })],
      ctx(),
    );
    expect(rows.map((row) => row.subject.playerId)).toEqual(['playing']);
    expect(rows[0]?.gameId).toBe('game-phi');
  });

  it('emits two rows when the same player is active in two leagues', () => {
    const rows = rosteredStakesFor(
      [
        slot({ leagueId: LEAGUE_A, platform: 'sleeper' }),
        slot({ leagueId: LEAGUE_B, platform: 'manual' }),
      ],
      ctx(),
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.sourceRef)).toEqual([LEAGUE_A, LEAGUE_B]);
    expect(rows.map((row) => row.source)).toEqual(['SLEEPER_ROSTER', 'MANUAL']);
    expect(rows.every((row) => row.subject.playerId === 'player-wr')).toBe(true);
  });

  it('keeps every fallback player and still drops a matchup bench player', () => {
    const rows = rosteredStakesFor(
      [
        slot({ playerId: 'm-starter', slotType: 'starter', lineupSource: 'matchup' }),
        slot({ playerId: 'm-bench', slotType: 'bench', lineupSource: 'matchup', teamId: CHI }),
        slot({
          playerId: 'fb-1',
          slotType: '',
          lineupSource: 'roster_fallback',
          leagueId: LEAGUE_B,
        }),
        slot({
          playerId: 'fb-2',
          slotType: '',
          lineupSource: 'roster_fallback',
          leagueId: LEAGUE_B,
          teamId: CHI,
        }),
        slot({
          playerId: 'fb-3',
          slotType: '',
          lineupSource: 'roster_fallback',
          leagueId: LEAGUE_B,
          position: 'QB',
        }),
      ],
      ctx(),
    );

    expect(rows.filter((row) => row.sourceRef === LEAGUE_B)).toHaveLength(3);
    expect(rows.map((row) => row.subject.playerId)).toEqual(['m-starter', 'fb-1', 'fb-2', 'fb-3']);
  });

  it('matches the player set the cache would keep if both leagues were watched', () => {
    // `rebuildUserLineupCache` is not pure: it reads Supabase and writes the cache
    // (lineup-sync.ts:266-373). This expectation is copied from the fallback branch
    // (lineup-sync.ts:320-332) and the starter/flex read (lineup-sync.ts:336-341).
    const rows = rosteredStakesFor(
      [
        slot({ playerId: 'starter-wr', teamId: PHI, slotType: 'starter', lineupSource: 'matchup' }),
        slot({
          playerId: 'flex-rb',
          teamId: CHI,
          slotType: 'flex',
          lineupSource: 'matchup',
          position: 'RB',
        }),
        slot({ playerId: 'bench-qb', teamId: PHI, slotType: 'bench', lineupSource: 'matchup' }),
        slot({
          playerId: 'fb-1',
          teamId: PHI,
          slotType: '',
          lineupSource: 'roster_fallback',
          leagueId: LEAGUE_B,
        }),
        slot({
          playerId: 'fb-2',
          teamId: CHI,
          slotType: '',
          lineupSource: 'roster_fallback',
          leagueId: LEAGUE_B,
        }),
        slot({
          playerId: 'fb-3',
          teamId: PHI,
          slotType: '',
          lineupSource: 'roster_fallback',
          leagueId: LEAGUE_B,
          position: 'DEF',
        }),
      ],
      ctx(),
    );

    const stakePlayers = rows.map((row) => `${row.subject.playerId}:${row.subject.teamId}`).sort();
    expect(stakePlayers).toEqual(
      [`starter-wr:${PHI}`, `flex-rb:${CHI}`, `fb-1:${PHI}`, `fb-2:${CHI}`, `fb-3:${PHI}`].sort(),
    );
  });

  it('keeps a D/ST starter on its team, the same players the cache keeps for DEF', () => {
    const rows = rosteredStakesFor(
      [slot({ playerId: 'phi-dst', teamId: PHI, position: 'DEF', slotType: 'starter' })],
      ctx(),
    );
    expect(rows).toEqual([
      {
        userId: USER,
        season: 2026,
        week: 5,
        gameId: 'game-phi',
        subject: { type: 'PLAYER', playerId: 'phi-dst', teamId: PHI },
        condition: { type: 'ROSTERED' },
        source: 'SLEEPER_ROSTER',
        sourceRef: LEAGUE_A,
        weight: 1,
      },
    ]);
  });
});

function stored(row: RosteredStakeInsert, id: string): StoredRosteredStake {
  return {
    id,
    playerId: row.subject.playerId,
    teamId: row.subject.teamId,
    gameId: row.gameId,
  };
}

describe('diffRosteredSet', () => {
  const alpha = rosteredStakesFor([slot({ playerId: 'alpha' })], ctx())[0];
  const bravo = rosteredStakesFor([slot({ playerId: 'bravo', position: 'RB' })], ctx())[0];
  if (!alpha || !bravo) throw new Error('expected stake rows');

  it('inserts a starter that is not stored yet', () => {
    expect(diffRosteredSet([], [alpha])).toEqual({
      deleteIds: [],
      inserts: [alpha],
      updates: [],
    });
  });

  it('deletes a starter that left the active set', () => {
    expect(diffRosteredSet([stored(alpha, 'id-alpha')], [])).toEqual({
      deleteIds: ['id-alpha'],
      inserts: [],
      updates: [],
    });
  });

  it('swaps one starter for another', () => {
    expect(diffRosteredSet([stored(alpha, 'id-alpha')], [bravo])).toEqual({
      deleteIds: ['id-alpha'],
      inserts: [bravo],
      updates: [],
    });
  });

  it('deletes every row in the set on disconnect', () => {
    const existing = [stored(alpha, 'id-alpha'), stored(bravo, 'id-bravo')];
    expect(diffRosteredSet(existing, []).deleteIds).toEqual(['id-alpha', 'id-bravo']);
    expect(diffRosteredSet(existing, []).inserts).toEqual([]);
  });

  it('is empty when the stored set already matches', () => {
    const existing = [stored(alpha, 'id-alpha'), stored(bravo, 'id-bravo')];
    expect(diffRosteredSet(existing, [alpha, bravo])).toEqual({
      deleteIds: [],
      inserts: [],
      updates: [],
    });
  });
});

describe('gameIdByTeam', () => {
  it('resolves a week that has both a preseason and a regular-season game to the regular game', () => {
    const resolved = gameIdByTeam([
      { id: 'game-phi', homeTeamId: PHI, awayTeamId: CHI, seasonType: 'regular' },
      { id: 'game-phi-pre', homeTeamId: PHI, awayTeamId: 'team-other', seasonType: 'pre' },
    ]);
    expect(resolved.get(PHI)).toBe('game-phi');
    expect(resolved.get(CHI)).toBe('game-phi');
    expect(resolved.has('team-other')).toBe(false);
    expect(resolved.has(BYE)).toBe(false);
  });

  it('logs and skips a team that still has two regular-season games', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const resolved = gameIdByTeam([
      { id: 'game-a', homeTeamId: PHI, awayTeamId: CHI, seasonType: 'regular' },
      { id: 'game-b', homeTeamId: PHI, awayTeamId: 'team-other', seasonType: 'regular' },
    ]);
    expect(resolved.has(PHI)).toBe(false);
    expect(resolved.get(CHI)).toBe('game-a');
    expect(error).toHaveBeenCalledWith('[stakes] ambiguous game team=team-phi games=game-a,game-b');
    error.mockRestore();
  });
});
