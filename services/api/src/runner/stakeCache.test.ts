import { describe, expect, it } from 'vitest';
import { InMemoryLineupCache } from '../cache/in-memory.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import { createNoStakeWarner, NO_STAKE_WARNING, rebuildStakeCache } from './stakeCache.js';

const LEAGUE = '11111111-1111-4111-8111-111111111111';
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function supabaseForWatchedStarters(): SupabaseServiceClient {
  return {
    from(table: string) {
      if (table === 'users') {
        return {
          select(columns: string) {
            if (columns === 'id') {
              return Promise.resolve({
                data: [{ id: USER_A }, { id: USER_B }],
                error: null,
              });
            }
            return {
              eq() {
                return {
                  single: () =>
                    Promise.resolve({
                      data: {
                        preferences: { watchedLeagueIds: [LEAGUE] },
                        subscription_tier: 'free',
                      },
                      error: null,
                    }),
                };
              },
            };
          },
        };
      }
      if (table === 'leagues') {
        return {
          select() {
            return {
              eq() {
                return {
                  order: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: LEAGUE,
                          lineup_source: 'matchup',
                          fallback_roster: null,
                        },
                      ],
                      error: null,
                    }),
                };
              },
            };
          },
        };
      }
      if (table === 'lineup_slots') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      in: () =>
                        Promise.resolve({
                          data: [
                            {
                              player_id: 'p-rb',
                              is_star: false,
                              players: { team_id: 'team-buf', position: 'RB' },
                            },
                            {
                              player_id: 'p-wr',
                              is_star: false,
                              players: { team_id: 'team-kc', position: 'WR' },
                            },
                          ],
                          error: null,
                        }),
                    };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseServiceClient;
}

describe('rebuildStakeCache', () => {
  it('rebuilds watched lineups for the current week and logs unique teams', async () => {
    const lineupCache = new InMemoryLineupCache();
    await lineupCache.setNflState(
      { season: '2026', week: 3, seasonType: 'regular', seasonStartDate: null },
      300,
    );
    const logs: string[] = [];
    const result = await rebuildStakeCache({
      supabase: supabaseForWatchedStarters(),
      lineupCache,
      log: (line) => logs.push(line),
    });
    expect(result).toEqual({ users: 2, teams: 2 });
    expect(logs).toEqual(['[runner] stake cache: 2 users, 2 teams']);
    expect(await lineupCache.getUsersWithStake('team-buf')).toEqual([USER_A, USER_B]);
    expect((await lineupCache.getLineupCache(USER_A, 3))?.playerToTeam.get('p-rb')).toBe(
      'team-buf',
    );
  });
});

describe('no stake users warning', () => {
  const live = [
    { homeTeamId: 'buf', awayTeamId: 'lac' },
    { homeTeamId: 'kc', awayTeamId: 'mia' },
  ];

  it('logs once when no live game has a stake user on either team', async () => {
    const logs: string[] = [];
    const warn = createNoStakeWarner((line) => logs.push(line));
    const empty = () => Promise.resolve([]);
    await warn(live, empty);
    await warn(live, empty);
    expect(logs).toEqual([NO_STAKE_WARNING]);
  });

  it('stays quiet when any live game has a stake user, and when nothing is live', async () => {
    const logs: string[] = [];
    const warn = createNoStakeWarner((line) => logs.push(line));
    await warn([], () => Promise.resolve([]));
    await warn(live, (teamId) => Promise.resolve(teamId === 'mia' ? ['user-1'] : []));
    expect(logs).toEqual([]);
  });
});
