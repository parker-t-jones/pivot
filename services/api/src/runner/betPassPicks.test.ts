import type { PlayEvent, Trigger } from '@pivot/engine';
import type { FlagEvent, GamePlayerStats, GameState } from '@pivot/shared';
import { describe, expect, it } from 'vitest';
import { InMemoryLineupCache } from '../cache/in-memory.js';
import { MemSupabase } from '../lib/memSupabase.test-helper.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import {
  createBetStakeCache,
  oneLegPerSlipAndCode,
  runBetPass,
  type PreparedBet,
} from './betPass.js';

const GAME = 'e67747a6-c528-4508-b08d-e63c6f589f2e';
const USER = '2057923d-af10-4bfc-966c-db93341863f2';
const HOME = 'chi';
const AWAY = 'phi';
const RB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SLIP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

class MemRedis {
  readonly values = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: GAME,
    homeTeamId: HOME,
    awayTeamId: AWAY,
    possessionTeamId: AWAY,
    unitOnField: 'offense',
    scoreHome: 7,
    scoreAway: 3,
    quarter: 2,
    timeRemainingSec: 400,
    yardsToOpponentEndzone: 40,
    down: 1,
    distance: 10,
    inRedZone: false,
    status: 'in_progress',
    updatedAt: 1,
    ...overrides,
  };
}

function play(): PlayEvent {
  return {
    playId: 'p1',
    gameId: GAME,
    week: 5,
    homeTeamId: HOME,
    awayTeamId: AWAY,
    possessionTeamId: AWAY,
    playType: 'run',
    scoreHome: 7,
    scoreAway: 3,
    quarter: 2,
    secondsRemainingInQuarter: 400,
    yardsToOpponentEndzone: 40,
    down: 1,
    distance: 10,
    isFinalPlay: false,
  };
}

function stakeRow(id: string, playerId: string, line: number, slipId: string | null = null) {
  return {
    id,
    user_id: USER,
    season: 2026,
    week: 5,
    game_id: GAME,
    subject: { type: 'PLAYER', playerId, teamId: AWAY },
    condition: { type: 'STAT_OVER', stat: 'RUSH_YDS', line },
    source: 'MANUAL',
    weight: 1,
    created_at: '2026-10-10T00:00:00.000Z',
    slip_id: slipId,
  };
}

function stats(rushYards: number): GamePlayerStats {
  return {
    gameId: GAME,
    fetchedAt: 1,
    final: false,
    players: {
      '111': { teamId: AWAY, displayName: 'Saquon Barkley', stats: { RUSH_YDS: rushYards } },
    },
    linescores: { home: [7, 0], away: [3, 0] },
    scoringPlays: [],
  };
}

async function harness(rows: Record<string, unknown>[]) {
  const db = new MemSupabase();
  db.rows('stakes').push(...rows);
  db.rows('players').push(
    {
      id: RB,
      team_id: AWAY,
      position: 'RB',
      espn_id: '111',
      first_name: 'Saquon',
      last_name: 'Barkley',
    },
    {
      id: WR,
      team_id: AWAY,
      position: 'WR',
      espn_id: '333',
      first_name: 'A.J.',
      last_name: 'Brown',
    },
  );
  const lineupCache = new InMemoryLineupCache();
  await lineupCache.addUserBet(GAME, USER, 5);
  const events: FlagEvent[] = [];
  return {
    db,
    events,
    deps: {
      lineupCache,
      supabase: db as unknown as SupabaseServiceClient,
      redis: new MemRedis(),
      dispatcher: {
        async dispatch(event: FlagEvent) {
          events.push(event);
        },
      },
      cache: createBetStakeCache(),
      clock: () => 1_700_000_000_000,
    },
  };
}

describe('runBetPass with player props', () => {
  it('nudges a player prop when its player is on the field, labelled with the player', async () => {
    const h = await harness([stakeRow('s1', RB, 89.5)]);
    await runBetPass(play(), state(), { ...h.deps, playerStats: () => stats(20) });
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({
      type: 'bet_in_play',
      stakeId: 's1',
      code: 'PROP_LIVE_POSSESSION',
      label: 'S. Barkley over 89.5 rush yds',
    });
  });

  it('sends the near REVEAL into the same gated dispatcher as every other bet event', async () => {
    const h = await harness([stakeRow('s1', RB, 89.5)]);
    await runBetPass(play(), state({ possessionTeamId: HOME }), {
      ...h.deps,
      playerStats: () => stats(80),
    });
    expect(h.events.map((event) => event.code)).toEqual(['PROP_NEAR']);
  });

  it('fires each code once per pick per game', async () => {
    const h = await harness([stakeRow('s1', RB, 89.5)]);
    const deps = { ...h.deps, playerStats: () => stats(20) };
    await runBetPass(play(), state(), deps);
    await runBetPass({ ...play(), playId: 'p2' }, state(), deps);
    expect(h.events).toHaveLength(1);
  });

  it('sends one event per code for a parlay’s legs in the same game', async () => {
    const h = await harness([stakeRow('leg1', RB, 89.5, SLIP), stakeRow('leg2', WR, 49.5, SLIP)]);
    await runBetPass(play(), state(), { ...h.deps, playerStats: () => stats(20) });
    expect(h.events).toHaveLength(1);
    expect(h.events[0]?.code).toBe('PROP_LIVE_POSSESSION');
  });
});

describe('oneLegPerSlipAndCode', () => {
  const bet = (id: string, slipId?: string): PreparedBet => ({
    label: id,
    stake: {
      id,
      userId: USER,
      season: 2026,
      week: 5,
      gameId: GAME,
      subject: { type: 'GAME', gameId: GAME },
      condition: { type: 'TOTAL_OVER', line: 40.5 },
      source: 'MANUAL',
      weight: 1,
      createdAt: '',
      ...(slipId ? { slipId } : {}),
    },
  });
  const trig = (stakeId: string, code: Trigger['code'], leverage: number): Trigger => ({
    stakeId,
    gameId: GAME,
    code,
    kind: 'NUDGE',
    leverage,
    dedupeKey: `${stakeId}:${code}`,
  });

  it('keeps singles and the highest-leverage leg per slip and code', () => {
    const kept = oneLegPerSlipAndCode([
      { trigger: trig('single', 'PROP_LIVE_POSSESSION', 0.1), bet: bet('single') },
      { trigger: trig('a', 'PROP_LIVE_POSSESSION', 0.2), bet: bet('a', SLIP) },
      { trigger: trig('b', 'PROP_LIVE_POSSESSION', 0.6), bet: bet('b', SLIP) },
      { trigger: trig('a', 'PROP_NEAR', 0.7), bet: bet('a', SLIP) },
    ]);
    expect(kept.map((entry) => `${entry.trigger.stakeId}:${entry.trigger.code}`)).toEqual([
      'single:PROP_LIVE_POSSESSION',
      'b:PROP_LIVE_POSSESSION',
      'a:PROP_NEAR',
    ]);
  });
});
