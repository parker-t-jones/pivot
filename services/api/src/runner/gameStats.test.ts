import type { EspnSummary } from '@pivot/ingestion';
import type { GameState } from '@pivot/shared';
import { describe, expect, it, vi } from 'vitest';
import { readGamePlayerStats } from '../lib/gamePlayerStats.js';
import { MemSupabase } from '../lib/memSupabase.test-helper.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import { createGameStatsRecorder } from './gameStats.js';

const GAME = 'game-1';
const HOME = 'uuid-gb';
const AWAY = 'uuid-atl';
const ABBR = new Map([
  ['GB', HOME],
  ['ATL', AWAY],
]);

function summary(final: boolean, rushYards: string): EspnSummary {
  return {
    header: {
      competitions: [
        {
          competitors: [
            { id: '9', homeAway: 'home', team: { abbreviation: 'GB' }, linescores: [{ value: 7 }] },
            {
              id: '1',
              homeAway: 'away',
              team: { abbreviation: 'ATL' },
              linescores: [{ value: 10 }],
            },
          ],
          status: { type: { state: final ? 'post' : 'in', completed: final } },
        },
      ],
    },
    boxscore: {
      players: [
        {
          team: { abbreviation: 'ATL' },
          statistics: [
            {
              name: 'rushing',
              keys: ['rushingYards', 'rushingTouchdowns'],
              athletes: [
                { athlete: { id: '111', displayName: 'Bijan Robinson' }, stats: [rushYards, '0'] },
              ],
            },
          ],
        },
      ],
    },
    scoringPlays: [
      {
        team: { abbreviation: 'ATL' },
        period: { number: 1 },
        type: { abbreviation: 'FG' },
        text: 'FG',
      },
    ],
  };
}

class MemRedis {
  values = new Map<string, string>();
  failWrites = false;
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string) {
    if (this.failWrites) throw new Error('redis down');
    this.values.set(key, value);
  }
}

function setup(gameState: GameState | null = null) {
  const db = new MemSupabase();
  db.rows('players').push({
    id: 'rb',
    team_id: AWAY,
    position: 'RB',
    espn_id: '111',
    first_name: 'Bijan',
    last_name: 'Robinson',
  });
  db.rows('stakes').push({
    id: 's1',
    user_id: 'u',
    season: 2026,
    week: 4,
    game_id: GAME,
    subject: { type: 'PLAYER', playerId: 'rb', teamId: AWAY },
    condition: { type: 'STAT_OVER', stat: 'RUSH_YDS', line: 89.5 },
    source: 'MANUAL',
    weight: 1,
    created_at: '',
    slip_id: null,
    result: null,
  });
  const redis = new MemRedis();
  const recorder = createGameStatsRecorder({
    gameId: GAME,
    homeTeamId: HOME,
    awayTeamId: AWAY,
    abbrToUuid: ABBR,
    redis,
    supabase: db as unknown as SupabaseServiceClient,
    getGameState: async () => gameState,
    now: () => new Date('2026-09-26T03:30:00.000Z'),
  });
  return { db, redis, recorder };
}

describe('createGameStatsRecorder', () => {
  it('publishes parsed stats with Pivot team ids and keeps them for the bet pass', async () => {
    const { redis, recorder } = setup();
    await recorder.record(summary(false, '40'), 5);
    const stored = await readGamePlayerStats(redis, GAME);
    expect(stored?.players['111']).toEqual({
      teamId: AWAY,
      displayName: 'Bijan Robinson',
      stats: { RUSH_YDS: 40, RUSH_REC_YDS: 40, ANY_TD: 0 },
    });
    expect(stored?.scoringPlays[0]?.teamId).toBe(AWAY);
    expect(recorder.latest()).toEqual(stored);
  });

  it('settles once on the first final summary, even with no live game state', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { db, recorder } = setup(null);
    await recorder.record(summary(false, '40'), 1);
    expect(db.rows('stakes')[0]?.['result']).toBeNull();
    await recorder.record(summary(true, '120'), 2);
    expect(db.rows('stakes')[0]).toMatchObject({ result: 'won', result_value: 120 });
    db.at('stakes', 0)['result'] = null;
    await recorder.record(summary(true, '120'), 3);
    expect(db.rows('stakes')[0]?.['result']).toBeNull();
    vi.restoreAllMocks();
  });

  it('keeps the in-memory copy and still settles when the Redis write fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { db, redis, recorder } = setup();
    redis.failWrites = true;
    await recorder.record(summary(true, '120'), 1);
    expect(recorder.latest()?.final).toBe(true);
    expect(db.rows('stakes')[0]?.['result']).toBe('won');
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('player stats write failed'));
    vi.restoreAllMocks();
  });
});
