import {
  InMemoryGameStateProvider,
  type PlayEvent,
  type Stake,
  evaluateStake,
} from '@pivot/engine';
import type { GameState, UserLineupCache } from '@pivot/shared';
import { InMemoryResumptionOpenStore, ResumptionCeiling } from '@pivot/dispatcher';
import type { ResumptionGatedDispatcher } from '@pivot/dispatcher';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import type { FireClaimRedis } from '../lib/fireClaim.js';
import { betPriorityScore, createBetStakeCache, runBetPass, type BetPassDeps } from './betPass.js';
import { createPlaySession } from './playSession.js';

const GAME = 'e67747a6-c528-4508-b08d-e63c6f589f2e';
const USER = '2057923d-af10-4bfc-966c-db93341863f2';
const STAKE_ID = '11111111-1111-4111-8111-111111111111';

class MemRedis implements FireClaimRedis {
  readonly values = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

interface LoggedRow {
  stake_id: string;
  code: string;
  drive_key: string;
  kind: string;
}

function claimClient(stakes: Record<string, unknown>[]): {
  client: SupabaseServiceClient;
  stakeReads: () => number;
  rows: LoggedRow[];
} {
  const rows: LoggedRow[] = [];
  let chain: Promise<void> = Promise.resolve();
  let stakeReads = 0;
  const client = {
    from(table: string) {
      if (table === 'stakes') {
        return {
          select() {
            return {
              eq() {
                stakeReads += 1;
                return Promise.resolve({ data: stakes, error: null });
              },
            };
          },
        };
      }
      if (table === 'teams') {
        return {
          select() {
            return {
              in() {
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
        };
      }
      if (table === 'stake_trigger_log') {
        return {
          upsert(row: LoggedRow) {
            return {
              select(): Promise<{
                data: { id: string }[] | null;
                error: { message: string } | null;
              }> {
                const run = chain.then(() => {
                  if (
                    rows.some(
                      (existing) =>
                        existing.stake_id === row.stake_id && existing.code === row.code,
                    )
                  ) {
                    return { data: [], error: null };
                  }
                  rows.push(row);
                  return { data: [{ id: 'row-1' }], error: null };
                });
                chain = run.then(
                  () => undefined,
                  () => undefined,
                );
                return run;
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return {
    client: client as unknown as SupabaseServiceClient,
    stakeReads: () => stakeReads,
    rows,
  };
}

function totalOverRow(): Record<string, unknown> {
  return {
    id: STAKE_ID,
    user_id: USER,
    season: 2026,
    week: 5,
    game_id: GAME,
    subject: { type: 'GAME', gameId: GAME },
    condition: { type: 'TOTAL_OVER', line: 30.5 },
    source: 'MANUAL',
    weight: 1,
    created_at: '2026-10-10T00:00:00.000Z',
  };
}

function q4(): GameState {
  return {
    gameId: GAME,
    homeTeamId: 'chi',
    awayTeamId: 'phi',
    possessionTeamId: 'phi',
    unitOnField: 'offense',
    scoreHome: 20,
    scoreAway: 7,
    quarter: 4,
    timeRemainingSec: 300,
    yardsToOpponentEndzone: 40,
    down: 1,
    distance: 10,
    inRedZone: false,
    status: 'in_progress',
    updatedAt: 1,
  };
}

function play(playId = '401872963999'): PlayEvent {
  return {
    playId,
    gameId: GAME,
    week: 5,
    homeTeamId: 'chi',
    awayTeamId: 'phi',
    possessionTeamId: 'phi',
    playType: 'run',
    scoreHome: 20,
    scoreAway: 7,
    quarter: 4,
    secondsRemainingInQuarter: 300,
    yardsToOpponentEndzone: 40,
    down: 1,
    distance: 10,
    isFinalPlay: false,
    wallclock: '2026-09-29T02:36:45Z',
    seenAt: '2026-10-10T08:35:00.000Z',
  };
}

function deps(
  partial: Partial<BetPassDeps> & Pick<BetPassDeps, 'supabase' | 'lineupCache'>,
): BetPassDeps {
  return {
    redis: partial.redis ?? new MemRedis(),
    dispatcher: partial.dispatcher ?? {
      async dispatch() {
        return undefined;
      },
    },
    cache: partial.cache ?? createBetStakeCache(),
    clock: partial.clock ?? (() => 1_700_000_000_000),
    supabase: partial.supabase,
    lineupCache: partial.lineupCache,
  };
}

describe('betPriorityScore', () => {
  it('stays at least 1 and rounds leverage times 12', () => {
    expect(betPriorityScore(0)).toBe(1);
    expect(betPriorityScore(0.04)).toBe(1);
    expect(betPriorityScore(0.5)).toBe(6);
    expect(betPriorityScore(1)).toBe(12);
  });
});

describe('runBetPass', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns before any other read when nobody has a bet on the game', async () => {
    const cache = createBetStakeCache();
    const get = vi.spyOn(cache, 'get');
    const dispatched: string[] = [];
    await runBetPass(
      play(),
      q4(),
      deps({
        cache,
        lineupCache: {
          async getUsersWithBet() {
            return [];
          },
        },
        supabase: {
          from() {
            throw new Error('db');
          },
        } as unknown as SupabaseServiceClient,
        dispatcher: {
          async dispatch(event) {
            dispatched.push(event.type);
          },
        },
      }),
    );
    expect(get).not.toHaveBeenCalled();
    expect(dispatched).toEqual([]);
  });

  it('dispatches a firing stake once and skips the same state on the next play', async () => {
    const db = claimClient([totalOverRow()]);
    const redis = new MemRedis();
    const dispatched: {
      type: string;
      priority: number;
      label: string | undefined;
      playId: string | null;
    }[] = [];
    const passDeps = deps({
      supabase: db.client,
      redis,
      lineupCache: {
        async getUsersWithBet() {
          return [USER];
        },
      },
      dispatcher: {
        async dispatch(event, playId) {
          dispatched.push({
            type: event.type,
            priority: event.newState.priorityScore,
            label: event.label,
            playId: playId ?? null,
          });
        },
      },
    });
    const state = q4();
    await runBetPass(play('play-a'), state, passDeps);
    await runBetPass(play('play-b'), state, passDeps);

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      type: 'bet_in_play',
      label: 'Over 30.5',
      playId: 'play-a',
    });
    const stake: Stake = {
      id: STAKE_ID,
      userId: USER,
      season: 2026,
      week: 5,
      gameId: GAME,
      subject: { type: 'GAME', gameId: GAME },
      condition: { type: 'TOTAL_OVER', line: 30.5 },
      source: 'MANUAL',
      weight: 1,
      createdAt: '2026-10-10T00:00:00.000Z',
    };
    const trigger = evaluateStake(stake, { gameId: GAME, game: state, lineup: emptyLineup() })[0];
    expect(dispatched[0]?.priority).toBe(betPriorityScore(trigger?.leverage ?? 0));
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ drive_key: GAME, kind: 'REVEAL', code: 'TOTAL_SWING' });
  });

  it('reloads bet stakes after 60 seconds', async () => {
    const db = claimClient([]);
    const cache = createBetStakeCache();
    let now = 1_000;
    const passDeps = deps({
      supabase: db.client,
      cache,
      clock: () => now,
      lineupCache: {
        async getUsersWithBet() {
          return [USER];
        },
      },
    });
    await runBetPass(play(), q4(), passDeps);
    now += 59_999;
    await runBetPass(play(), q4(), passDeps);
    expect(db.stakeReads()).toBe(1);
    now += 1;
    await runBetPass(play(), q4(), passDeps);
    expect(db.stakeReads()).toBe(2);
  });
});

describe('handlePlay bet pass', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs a throwing dependency and still finishes the fantasy dispatch', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const control = await fantasyDispatch();
    const dispatched = await fantasyDispatch((current, state) =>
      runBetPass(
        current,
        state,
        deps({
          lineupCache: {
            async getUsersWithBet() {
              throw new Error('boom');
            },
          },
          supabase: {
            from() {
              throw new Error('db');
            },
          } as unknown as SupabaseServiceClient,
        }),
      ),
    );
    expect(dispatched.map(summary)).toEqual(control.map(summary));
    expect(error).toHaveBeenCalledWith('[bets] pass failed game=g1 err=boom');
  });
});

function emptyLineup(): UserLineupCache {
  return {
    userId: 'u1',
    week: 8,
    teamPositions: new Map(),
    playerToTeam: new Map(),
    starPlayerIds: new Set(),
  };
}

function summary(event: { type: string; userId: string; id: string }): string {
  return `${event.type}:${event.userId}:${event.id}`;
}

async function fantasyDispatch(
  runBetPassImpl?: (play: PlayEvent, gameState: GameState) => Promise<void>,
): Promise<{ type: string; userId: string; id: string }[]> {
  const gameState = new InMemoryGameStateProvider();
  const lineup: UserLineupCache = {
    userId: 'u1',
    week: 8,
    teamPositions: new Map([['KC', new Set(['offense'])]]),
    playerToTeam: new Map([['rb-1', 'KC']]),
    starPlayerIds: new Set(),
  };
  gameState.addStake('KC', 'u1');
  const dispatched: { type: string; userId: string; id: string }[] = [];
  const gate = {
    beginPlay() {
      return undefined;
    },
    noteWindowOpened() {
      return undefined;
    },
    noteResolution() {
      return Promise.resolve();
    },
    async releaseMidDrive() {
      return undefined;
    },
    async endPlay() {
      return undefined;
    },
    async dispatch(event: { type: string; userId: string; id: string }) {
      dispatched.push({ type: event.type, userId: event.userId, id: event.id });
    },
  };
  const session = createPlaySession({
    gameId: 'g1',
    gate: gate as unknown as ResumptionGatedDispatcher,
    ceiling: new ResumptionCeiling({
      store: new InMemoryResumptionOpenStore(),
      onFire() {
        return undefined;
      },
    }),
    onPlay: {
      lineupCache: {
        async getLineupCache() {
          return lineup;
        },
      },
      gameState,
      dispatcher: gate as unknown as ResumptionGatedDispatcher,
      clock: () => 1_700_000_000_000,
    },
    ...(runBetPassImpl ? { runBetPass: runBetPassImpl } : {}),
  });
  await session.handlePlay({
    playId: 'p1',
    gameId: 'g1',
    week: 8,
    homeTeamId: 'LV',
    awayTeamId: 'KC',
    possessionTeamId: 'KC',
    playType: 'run',
    scoreHome: 0,
    scoreAway: 0,
    quarter: 1,
    secondsRemainingInQuarter: 900,
    yardsToOpponentEndzone: 50,
    down: 1,
    distance: 10,
    isFinalPlay: false,
  });
  return dispatched;
}
