import type { GamePlayerStats, GameState } from '@pivot/shared';
import { describe, expect, it } from 'vitest';
import { MemSupabase } from '../lib/memSupabase.test-helper.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import { finalGameState, settleGamePicks, settleSlip } from './settlePicks.js';

const GAME = 'game-1';
const OTHER_GAME = 'game-2';
const HOME = 'gb';
const AWAY = 'atl';
const RB = 'player-rb';
const SLIP = 'slip-1';
const NOW = new Date('2026-09-26T03:30:00.000Z');

const finalStats: GamePlayerStats = {
  gameId: GAME,
  fetchedAt: 1,
  final: true,
  players: { '4430807': { teamId: AWAY, displayName: 'Bijan Robinson', stats: { RUSH_YDS: 194 } } },
  linescores: { home: [7, 0, 0, 7], away: [7, 10, 7, 11] },
  scoringPlays: [{ teamId: HOME, period: 1, kind: 'TD', text: 'Christian Watson 4 Yd pass' }],
};

/** Play-derived state one play behind the final summary. */
const lagging: GameState = {
  gameId: GAME,
  homeTeamId: HOME,
  awayTeamId: AWAY,
  possessionTeamId: null,
  unitOnField: 'none',
  scoreHome: 14,
  scoreAway: 33,
  quarter: 4,
  timeRemainingSec: 5,
  yardsToOpponentEndzone: null,
  down: null,
  distance: null,
  inRedZone: false,
  status: 'in_progress',
  updatedAt: 1,
};

function row(id: string, overrides: Record<string, unknown>) {
  return {
    id,
    user_id: 'u',
    season: 2026,
    week: 4,
    game_id: GAME,
    source: 'MANUAL',
    weight: 1,
    created_at: '',
    slip_id: null,
    result: null,
    result_value: null,
    settled_at: null,
    ...overrides,
  };
}

function db() {
  const mem = new MemSupabase();
  mem.rows('players').push({
    id: RB,
    team_id: AWAY,
    position: 'RB',
    espn_id: '4430807',
    first_name: 'Bijan',
    last_name: 'Robinson',
  });
  return mem;
}

const rushOver = (id: string, line: number, extra: Record<string, unknown> = {}) =>
  row(id, {
    subject: { type: 'PLAYER', playerId: RB, teamId: AWAY },
    condition: { type: 'STAT_OVER', stat: 'RUSH_YDS', line },
    ...extra,
  });

describe('finalGameState', () => {
  it('marks the game final and takes the score from the summary linescores', () => {
    expect(finalGameState(lagging, finalStats)).toMatchObject({
      status: 'final',
      scoreHome: 14,
      scoreAway: 35,
    });
  });
});

describe('settleGamePicks', () => {
  it('writes results and the settled value for the game’s picks, and skips fantasy rows', async () => {
    const mem = db();
    mem.rows('stakes').push(
      rushOver('over', 89.5),
      row('ml', {
        subject: { type: 'TEAM', teamId: AWAY },
        condition: { type: 'MONEYLINE', side: 'TEAM' },
      }),
      row('spread', {
        subject: { type: 'TEAM', teamId: HOME },
        condition: { type: 'SPREAD', line: 21 },
      }),
      row('fantasy', {
        subject: { type: 'PLAYER', playerId: RB, teamId: AWAY },
        condition: { type: 'ROSTERED' },
        source: 'SLEEPER_ROSTER',
      }),
      rushOver('elsewhere', 10.5, { game_id: OTHER_GAME }),
    );
    const result = await settleGamePicks(
      mem as unknown as SupabaseServiceClient,
      lagging,
      finalStats,
      NOW,
    );
    expect(result).toEqual({ picks: 3, slips: 0 });
    const byId = new Map(mem.rows('stakes').map((r) => [r['id'], r]));
    expect(byId.get('over')).toMatchObject({
      result: 'won',
      result_value: 194,
      settled_at: NOW.toISOString(),
    });
    expect(byId.get('ml')).toMatchObject({ result: 'won' });
    expect(byId.get('spread')).toMatchObject({ result: 'tie' });
    expect(byId.get('fantasy')?.['result']).toBeNull();
    expect(byId.get('elsewhere')?.['result']).toBeNull();
  });

  it('changes nothing when run again', async () => {
    const mem = db();
    mem.rows('stakes').push(rushOver('over', 89.5));
    const client = mem as unknown as SupabaseServiceClient;
    await settleGamePicks(client, lagging, finalStats, NOW);
    const again = await settleGamePicks(
      client,
      lagging,
      finalStats,
      new Date('2027-01-01T00:00:00Z'),
    );
    expect(again).toEqual({ picks: 0, slips: 0 });
    expect(mem.rows('stakes')[0]?.['settled_at']).toBe(NOW.toISOString());
  });

  it('leaves a pick with no ESPN match unsettled instead of guessing', async () => {
    const mem = db();
    mem.at('players', 0)['espn_id'] = null;
    mem.at('players', 0)['first_name'] = 'Nobody';
    mem.rows('stakes').push(rushOver('over', 89.5));
    await settleGamePicks(mem as unknown as SupabaseServiceClient, lagging, finalStats, NOW);
    expect(mem.rows('stakes')[0]?.['result']).toBeNull();
  });

  it('settles a slip lost as soon as one leg loses, with other legs still open', async () => {
    const mem = db();
    mem.rows('pick_slips').push({ id: SLIP, user_id: 'u', season: 2026, week: 4, result: null });
    mem
      .rows('stakes')
      .push(
        rushOver('leg-lost', 200.5, { slip_id: SLIP }),
        rushOver('leg-open', 50.5, { slip_id: SLIP, game_id: OTHER_GAME }),
      );
    const result = await settleGamePicks(
      mem as unknown as SupabaseServiceClient,
      lagging,
      finalStats,
      NOW,
    );
    expect(result.slips).toBe(1);
    expect(mem.rows('pick_slips')[0]).toMatchObject({
      result: 'lost',
      settled_at: NOW.toISOString(),
    });
  });

  it('waits for every leg before settling a winning slip', async () => {
    const mem = db();
    mem.rows('pick_slips').push({ id: SLIP, user_id: 'u', season: 2026, week: 4, result: null });
    mem
      .rows('stakes')
      .push(
        rushOver('leg-won', 89.5, { slip_id: SLIP }),
        rushOver('leg-open', 50.5, { slip_id: SLIP, game_id: OTHER_GAME }),
      );
    const client = mem as unknown as SupabaseServiceClient;
    expect((await settleGamePicks(client, lagging, finalStats, NOW)).slips).toBe(0);
    expect(mem.rows('pick_slips')[0]?.['result']).toBeNull();

    mem.at('stakes', 1)['result'] = 'void';
    expect(await settleSlip(client, SLIP, NOW)).toBe(true);
    expect(mem.rows('pick_slips')[0]?.['result']).toBe('won');
  });
});
