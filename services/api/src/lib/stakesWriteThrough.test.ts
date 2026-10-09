import { describe, expect, it, vi } from 'vitest';
import {
  deleteLeagueStakes,
  formatStakesWriteFailure,
  stakesWriteEnabled,
  writeThroughLeagueStakes,
  writeThroughOpponentStakes,
} from './stakesWriteThrough.js';

describe('stakes write-through gate', () => {
  it('is off unless STAKES_WRITE=1', () => {
    expect(stakesWriteEnabled({})).toBe(false);
    expect(stakesWriteEnabled({ STAKES_WRITE: '0' })).toBe(false);
    expect(stakesWriteEnabled({ STAKES_WRITE: '1' })).toBe(true);
  });

  it('does not touch the database when the flag is off', async () => {
    let called = false;
    const supabase = {
      from() {
        called = true;
        throw new Error('should not be called');
      },
    };
    await writeThroughLeagueStakes(supabase as never, 'league-1', 5, {});
    await deleteLeagueStakes(supabase as never, 'user-1', 'league-1', {});
    expect(called).toBe(false);
  });

  it('logs and does not throw when the stake write fails', async () => {
    const supabase = {
      from() {
        throw new Error('db down');
      },
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      writeThroughLeagueStakes(supabase as never, 'league-1234', 5, { STAKES_WRITE: '1' }),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      formatStakesWriteFailure('', 'league-1234', new Error('db down')),
    );
    expect(String(spy.mock.calls[0]?.[0])).toBe(
      '[stakes] write-through failed user= ref=league-1234 err=db down',
    );
    spy.mockRestore();
  });
});

const WRITE_ENV = { STAKES_WRITE: '1' };
const LEAGUE_ID = 'league-1';
const USER_ID = 'user-1';

function queryClient(tables: Record<string, { data: unknown; error: null }>) {
  const deleted: string[][] = [];
  const inserted: unknown[] = [];
  const supabase = {
    from(table: string) {
      let deleting = false;
      const payload = tables[table] ?? { data: [], error: null as null };
      const chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        in(_column: string, ids: string[]) {
          if (deleting) deleted.push(ids);
          return Promise.resolve(deleting ? { data: null, error: null } : payload);
        },
        delete() {
          deleting = true;
          return chain;
        },
        insert(rows: unknown) {
          inserted.push(rows);
          return Promise.resolve({ error: null });
        },
        update() {
          return chain;
        },
        maybeSingle() {
          return Promise.resolve(payload);
        },
        then(
          onFulfilled: (value: typeof payload) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(payload).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
  return { supabase, deleted, inserted };
}

describe('opponent and rostered stake replaces', () => {
  it('does not delete an opponent row while replacing the rostered set', async () => {
    const { supabase, deleted, inserted } = queryClient({
      leagues: {
        data: {
          id: LEAGUE_ID,
          user_id: USER_ID,
          platform: 'sleeper',
          season_year: 2026,
          lineup_source: 'matchup',
          fallback_roster: null,
        },
        error: null,
      },
      lineup_slots: {
        data: [
          {
            player_id: 'player-wr',
            slot_type: 'starter',
            players: { team_id: 'team-phi', position: 'WR' },
          },
        ],
        error: null,
      },
      games: {
        data: [
          {
            id: 'game-phi',
            home_team_id: 'team-phi',
            away_team_id: 'team-chi',
            season_type: 'regular',
          },
        ],
        error: null,
      },
      stakes: {
        data: [
          {
            id: 'opp-1',
            game_id: 'game-phi',
            source: 'SLEEPER_OPPONENT',
            subject: { type: 'PLAYER', playerId: 'opp', teamId: 'team-chi' },
            condition: { type: 'OPPONENT_ROSTERED' },
          },
        ],
        error: null,
      },
    });

    await writeThroughLeagueStakes(supabase as never, LEAGUE_ID, 5, WRITE_ENV);

    expect(deleted.flat()).not.toContain('opp-1');
    expect(inserted).toHaveLength(1);
  });

  it('deletes the opponent set when the next list is empty', async () => {
    const { supabase, deleted } = queryClient({
      leagues: {
        data: {
          id: LEAGUE_ID,
          user_id: USER_ID,
          platform: 'sleeper',
          season_year: 2026,
        },
        error: null,
      },
      games: { data: [], error: null },
      stakes: {
        data: [
          {
            id: 'opp-1',
            game_id: 'game-phi',
            source: 'SLEEPER_OPPONENT',
            subject: { type: 'PLAYER', playerId: 'opp', teamId: 'team-chi' },
            condition: { type: 'OPPONENT_ROSTERED' },
          },
        ],
        error: null,
      },
    });

    await writeThroughOpponentStakes(supabase as never, LEAGUE_ID, 5, [], WRITE_ENV);
    expect(deleted).toEqual([['opp-1']]);
  });

  it('disconnect deletes rostered and opponent rows for the league', async () => {
    const { supabase, deleted } = queryClient({
      stakes: {
        data: [
          { id: 'rostered-1', condition: { type: 'ROSTERED' } },
          { id: 'opp-1', condition: { type: 'OPPONENT_ROSTERED' } },
          { id: 'money-1', condition: { type: 'MONEYLINE' } },
        ],
        error: null,
      },
    });

    await deleteLeagueStakes(supabase as never, USER_ID, LEAGUE_ID, WRITE_ENV);
    expect(deleted).toEqual([['rostered-1', 'opp-1']]);
  });
});
