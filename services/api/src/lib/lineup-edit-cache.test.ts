import {
  CapturingEventDispatcher,
  InMemoryGameStateProvider,
  onPlayEvent,
  type PlayEvent,
} from '@pivot/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryLineupCache } from '../cache/in-memory.js';
import type { SupabaseServiceClient } from './supabase.js';
import {
  rebuildUserLineupCache,
  refreshLineupCache,
  syncLeagueLineup,
  type LeagueRow,
} from './lineup-sync.js';

const { getFantasyProvider } = vi.hoisted(() => ({
  getFantasyProvider: vi.fn(),
}));

vi.mock('../providers/index.js', () => ({ getFantasyProvider }));

const LEAGUE = '11111111-1111-4111-8111-111111111111';
const USER = 'user-1';
const WEEK = 4;
const TEAM = 'team-cle';
const TE = 'player-te';
const RB = 'player-rb';

interface Slot {
  player_id: string;
  position: string;
}

function leagueRow(): LeagueRow {
  return {
    id: LEAGUE,
    user_id: USER,
    platform: 'sleeper',
    external_league_id: 'ext-league-1',
    external_roster_id: '2',
  };
}

function supabaseFor(slots: Slot[]): SupabaseServiceClient {
  return {
    from(table: string) {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: {
                    preferences: { watchedLeagueIds: [LEAGUE] },
                    subscription_tier: 'free',
                  },
                  error: null,
                }),
            }),
          }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      if (table === 'leagues') {
        return {
          select: () => ({
            eq: () => ({
              order: () =>
                Promise.resolve({
                  data: [{ id: LEAGUE, lineup_source: 'matchup', fallback_roster: null }],
                  error: null,
                }),
            }),
          }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      if (table === 'lineup_slots') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => {
                const existing = Promise.resolve({
                  data: slots.map((slot) => ({ player_id: slot.player_id })),
                  error: null,
                });
                return Object.assign(existing, {
                  in: () =>
                    Promise.resolve({
                      data: slots.map((slot) => ({
                        player_id: slot.player_id,
                        is_star: false,
                        players: { team_id: TEAM, position: slot.position },
                      })),
                      error: null,
                    }),
                });
              },
            }),
          }),
          upsert: (rows: { player_id: string; slot_type: string }[]) => {
            slots.splice(
              0,
              slots.length,
              ...rows
                .filter((row) => row.slot_type === 'starter' || row.slot_type === 'flex')
                .map((row) => ({
                  player_id: row.player_id,
                  position: row.player_id === TE ? 'TE' : 'RB',
                })),
            );
            return Promise.resolve({ error: null });
          },
          delete: () => ({
            eq: () => ({
              eq: () => ({
                in: () => Promise.resolve({ error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'players') {
        return {
          select: () => ({
            in: (_column: string, ids: string[]) =>
              Promise.resolve({
                data: ids.map((id) => ({
                  id: id === 'sl-te' ? TE : id === 'sl-rb' ? RB : id,
                  sleeper_id: id,
                  team_id: TEAM,
                  position: id === 'sl-te' || id === TE ? 'TE' : 'RB',
                })),
                error: null,
              }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseServiceClient;
}

function play(playId: string, yards: number): PlayEvent {
  return {
    playId,
    gameId: 'game-1',
    week: WEEK,
    homeTeamId: TEAM,
    awayTeamId: 'team-pit',
    possessionTeamId: TEAM,
    playType: 'run',
    scoreHome: 0,
    scoreAway: 0,
    quarter: 1,
    secondsRemainingInQuarter: 800,
    yardsToOpponentEndzone: yards,
    down: 1,
    distance: 10,
    isFinalPlay: false,
  };
}

describe('lineup edits rebuild both caches before the caller returns', () => {
  let slots: Slot[];
  let cache: InMemoryLineupCache;

  beforeEach(() => {
    slots = [];
    cache = new InMemoryLineupCache();
    getFantasyProvider.mockReset();
  });

  async function expectPlayer(playerId: string): Promise<void> {
    const lineup = await cache.getLineupCache(USER, WEEK);
    expect(lineup?.playerToTeam.get(playerId)).toBe(TEAM);
    expect(lineup?.playerUnits?.get(playerId)).toBe('offense');
    expect(await cache.getUsersWithStake(TEAM)).toContain(USER);
  }

  it('PUT /leagues/:id/lineup (refreshLineupCache) writes the new player with no worker tick', async () => {
    slots.push({ player_id: TE, position: 'TE' });
    await refreshLineupCache({ supabase: supabaseFor(slots), lineupCache: cache }, leagueRow(), WEEK, {
      lineupSource: 'matchup',
    });
    await expectPlayer(TE);
  });

  it('Sleeper /sync writes the new player with no worker tick', async () => {
    getFantasyProvider.mockReturnValue({
      supportsSync: () => true,
      fetchLineup: vi.fn().mockResolvedValue([
        { externalPlayerId: 'sl-te', slotType: 'starter', positionInLineup: 'TE' },
      ]),
      fetchRosterPlayers: vi.fn(),
    });
    await syncLeagueLineup(
      { supabase: supabaseFor(slots), lineupCache: cache },
      leagueRow(),
      { week: WEEK, displayPhase: 'regular' },
    );
    await expectPlayer(TE);
  });

  it('an Active Lineup change (rebuildUserLineupCache) writes the new player with no worker tick', async () => {
    slots.push({ player_id: TE, position: 'TE' });
    await rebuildUserLineupCache({ supabase: supabaseFor(slots), lineupCache: cache }, USER, WEEK);
    await expectPlayer(TE);
  });

  it('a player removed mid-game is absent from the next flag', async () => {
    slots.push({ player_id: TE, position: 'TE' }, { player_id: RB, position: 'RB' });
    const supabase = supabaseFor(slots);
    await rebuildUserLineupCache({ supabase, lineupCache: cache }, USER, WEEK);

    const gameState = new InMemoryGameStateProvider();
    const dispatcher = new CapturingEventDispatcher();
    gameState.addStake(TEAM, USER);
    const deps = {
      lineupCache: cache,
      gameState,
      dispatcher,
      clock: () => 1_700_000_000_000,
    };

    await onPlayEvent(deps, play('snap', 40));
    expect(dispatcher.events.at(-1)?.newState.reasons[0]?.triggeringPlayerIds.sort()).toEqual([
      RB,
      TE,
    ]);

    slots.splice(0, slots.length, { player_id: RB, position: 'RB' });
    await rebuildUserLineupCache({ supabase, lineupCache: cache }, USER, WEEK);
    const after = await cache.getLineupCache(USER, WEEK);
    expect(after?.playerToTeam.has(TE)).toBe(false);
    expect(await cache.getUsersWithStake(TEAM)).toContain(USER);

    await onPlayEvent(deps, { ...play('away', 40), possessionTeamId: 'team-pit' });
    await onPlayEvent(deps, play('back', 40));
    const listed = dispatcher.events
      .at(-1)
      ?.newState.reasons.find((reason) => reason.type === 'offense_active');
    expect(listed?.triggeringPlayerIds).toEqual([RB]);
  });
});
