import { describe, expect, it } from 'vitest';
import {
  rosteredStakesFor,
  type RosteredStakeSlot,
  type RosteredStakesContext,
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
