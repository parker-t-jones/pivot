import { evaluateStake, type Stake, type Trigger } from '@pivot/engine';
import type { GameState, UserLineupCache } from '@pivot/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseServiceClient } from './supabase.js';
import { claimFirstFire, firstFires, type FireClaimContext } from './fireClaim.js';

const STAKE = '2057923d-af10-4bfc-966c-db93341863f2';
const GAME = 'e67747a6-c528-4508-b08d-e63c6f589f2e';
const PHI = '4e380990-e5ea-4b5e-bed5-fa1b919830e3';
const CHI = 'f2624144-a1b6-4415-bacc-217a25b2aa62';

class MemRedis {
  readonly values = new Map<string, { value: string; ttlSec: number }>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    this.values.set(key, { value, ttlSec });
  }

  drop(key: string): void {
    this.values.delete(key);
  }
}

interface LoggedRow {
  id: string;
  stake_id: string;
  code: string;
  drive_key: string;
  kind: string;
}

function fireDb(): {
  client: SupabaseServiceClient;
  rows: LoggedRow[];
  calls: () => number;
  failWith: (message: string) => void;
} {
  const rows: LoggedRow[] = [];
  let chain: Promise<void> = Promise.resolve();
  let fail: { message: string } | null = null;
  let calls = 0;
  const client = {
    from(table: string) {
      if (table !== 'stake_trigger_log') throw new Error(`unexpected table ${table}`);
      return {
        upsert(row: Omit<LoggedRow, 'id'>) {
          return {
            select(): Promise<{
              data: { id: string }[] | null;
              error: { message: string } | null;
            }> {
              const run = chain.then(() => {
                calls += 1;
                if (fail) return { data: null, error: fail };
                if (
                  rows.some(
                    (existing) => existing.stake_id === row.stake_id && existing.code === row.code,
                  )
                ) {
                  return { data: [], error: null };
                }
                const created = {
                  id: `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, '0')}`,
                  ...row,
                };
                rows.push(created);
                return { data: [{ id: created.id }], error: null };
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
    },
  };
  return {
    client: client as unknown as SupabaseServiceClient,
    rows,
    calls: () => calls,
    failWith(message: string) {
      fail = { message };
    },
  };
}

function context(redis: MemRedis, client: SupabaseServiceClient): FireClaimContext {
  return { gameId: GAME, supabase: client, redis };
}

const lineup: UserLineupCache = {
  userId: 'u-replay',
  week: 5,
  teamPositions: new Map(),
  playerToTeam: new Map(),
  starPlayerIds: new Set(),
};

function survivorTriggers(): Trigger[] {
  const stake: Stake = {
    id: STAKE,
    userId: 'u-replay',
    season: 2026,
    week: 5,
    gameId: GAME,
    subject: { type: 'TEAM', teamId: PHI },
    condition: { type: 'SURVIVOR' },
    source: 'MANUAL',
    weight: 1,
    createdAt: '2026-10-09T16:00:00.000Z',
  };
  const game: GameState = {
    gameId: GAME,
    homeTeamId: CHI,
    awayTeamId: PHI,
    possessionTeamId: PHI,
    unitOnField: 'offense',
    scoreHome: 10,
    scoreAway: 7,
    quarter: 4,
    timeRemainingSec: 300,
    yardsToOpponentEndzone: 12,
    down: 1,
    distance: 10,
    inRedZone: true,
    status: 'in_progress',
    updatedAt: 1,
  };
  return evaluateStake(stake, { gameId: GAME, game, lineup });
}

describe('claimFirstFire', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true once, then false without another insert', async () => {
    const redis = new MemRedis();
    const db = fireDb();
    const ctx = context(redis, db.client);

    expect(await claimFirstFire(STAKE, 'ONE_SCORE_LATE', ctx)).toBe(true);
    expect(await claimFirstFire(STAKE, 'ONE_SCORE_LATE', ctx)).toBe(false);

    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({
      stake_id: STAKE,
      code: 'ONE_SCORE_LATE',
      drive_key: GAME,
      kind: 'REVEAL',
    });
    expect(db.calls()).toBe(1);
    expect(redis.values.get(`stake_fired:${STAKE}:ONE_SCORE_LATE`)?.ttlSec).toBe(24 * 60 * 60);
  });

  it('stays false after the redis key is lost and refills the key', async () => {
    const redis = new MemRedis();
    const db = fireDb();
    const ctx = context(redis, db.client);
    expect(await claimFirstFire(STAKE, 'SPREAD_SWING', ctx)).toBe(true);

    redis.drop(`stake_fired:${STAKE}:SPREAD_SWING`);
    expect(await claimFirstFire(STAKE, 'SPREAD_SWING', ctx)).toBe(false);

    expect(db.rows).toHaveLength(1);
    expect(db.calls()).toBe(2);
    expect(redis.values.get(`stake_fired:${STAKE}:SPREAD_SWING`)?.value).toBe('1');
  });

  it('lets two codes on one survivor stake each fire once', async () => {
    const redis = new MemRedis();
    const db = fireDb();
    const ctx = context(redis, db.client);
    const triggers = survivorTriggers();
    expect(triggers.map((trigger) => trigger.code)).toEqual(['ONE_SCORE_LATE', 'PICK_TRAILING_2H']);

    const claim = (trigger: Trigger) => claimFirstFire(trigger.stakeId, trigger.code, ctx);
    expect((await firstFires(triggers, claim)).map((trigger) => trigger.code)).toEqual([
      'ONE_SCORE_LATE',
      'PICK_TRAILING_2H',
    ]);
    expect(await firstFires(triggers, claim)).toEqual([]);
    expect(db.rows.map((row) => row.code)).toEqual(['ONE_SCORE_LATE', 'PICK_TRAILING_2H']);
  });

  it('returns false and logs when the insert fails', async () => {
    const redis = new MemRedis();
    const db = fireDb();
    db.failWith('connection reset');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await claimFirstFire(STAKE, 'TOTAL_SWING', context(redis, db.client))).toBe(false);
    expect(error).toHaveBeenCalledWith(
      `[stakes] fire-claim failed stake=${STAKE.slice(0, 8)} code=TOTAL_SWING err=connection reset`,
    );
    expect(redis.values.size).toBe(0);
    expect(db.rows).toHaveLength(0);
  });

  it('lets exactly one of two concurrent claims win', async () => {
    const redis = new MemRedis();
    const db = fireDb();
    const ctx = context(redis, db.client);
    const [first, second] = await Promise.all([
      claimFirstFire(STAKE, 'ONE_SCORE_LATE', ctx),
      claimFirstFire(STAKE, 'ONE_SCORE_LATE', ctx),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(db.rows).toHaveLength(1);
  });
});
