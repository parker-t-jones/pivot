import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyPlayType, type PlayEvent } from '@pivot/engine';
import {
  espnClient,
  EspnPlaySource,
  countSummaryPlays,
  summaryPlayPrefixes,
  translatePlay,
} from '@pivot/ingestion';
import {
  InMemoryBroadcastCatalog,
  InMemoryFlagEventPersistence,
  InMemoryFlagEventQueue,
  InMemoryGameCatalog,
  InMemoryGameStateStore,
  InMemoryPlayerCatalog,
  InMemoryRealtimeBus,
  InMemoryResumptionOpenStore,
  InMemoryUserDirectory,
  ResumptionCeiling,
  ResumptionGatedDispatcher,
  runDispatcherTick,
  type DeliveryDeps,
  type FlagEventQueue,
  type RateLimitStore,
} from '@pivot/dispatcher';
import { parsePreferences, type FlagEvent } from '@pivot/shared';
import { createPlaySession } from './runner/playSession.js';

const FIXTURE = fileURLToPath(
  new URL(
    '../../ingestion/fixtures/replays/401872948/2026-09-25T23:08:52.773Z.json.gz',
    import.meta.url,
  ),
);
const EVENT_ID = '401872948';
const GAME_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const HOME_ID = '11111111-1111-4111-8111-111111111111';
const AWAY_ID = '22222222-2222-4222-8222-222222222222';
const ABBR_TO_UUID = new Map<string, string>([
  ['GB', HOME_ID],
  ['ATL', AWAY_ID],
]);

interface SeenPlay {
  id: string;
  at: number;
  playType: PlayEvent['playType'];
}

interface Enqueued {
  scheduledFireAt: number;
  triggeringPlayId: string | null;
  eventType: FlagEvent['type'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function markInProgress(body: unknown): void {
  if (!isRecord(body)) return;
  const header = body['header'];
  if (!isRecord(header)) return;
  const competitions = header['competitions'];
  if (!Array.isArray(competitions) || !isRecord(competitions[0])) return;
  const status = competitions[0]['status'];
  if (!isRecord(status)) return;
  const type = status['type'];
  if (!isRecord(type)) return;
  type['state'] = 'in';
  type['completed'] = false;
  type['name'] = 'STATUS_IN_PROGRESS';
}

function gameClock(play: PlayEvent): number {
  const quarter = Math.max(play.quarter, 1);
  return (quarter - 1) * 15 * 60 * 1000 + (15 * 60 - play.secondsRemainingInQuarter) * 1000;
}

function rowId(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const id = data['event_id'];
  return typeof id === 'string' ? id : null;
}

function recordingQueue(): FlagEventQueue & { enqueued: Enqueued[] } {
  const inner = new InMemoryFlagEventQueue();
  const enqueued: Enqueued[] = [];
  return {
    enqueued,
    async enqueue(event: FlagEvent, triggeringPlayId: string | null) {
      enqueued.push({
        scheduledFireAt: event.scheduledFireAt,
        triggeringPlayId,
        eventType: event.type,
      });
      await inner.enqueue(event, triggeringPlayId);
    },
    due: (now, limit) => inner.due(now, limit),
    remove: (item) => inner.remove(item),
  };
}

function nextRealPlayAt(seen: readonly SeenPlay[], playId: string): number | undefined {
  const index = seen.findIndex((play) => play.id === playId);
  for (let i = index + 1; i < seen.length; i += 1) {
    const play = seen[i];
    if (play && classifyPlayType(play.playType) === 'REAL_ACTION') return play.at;
  }
  return undefined;
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries(counts);
}

describe('ATL @ GB replay', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const summary = JSON.parse(gunzipSync(readFileSync(FIXTURE)).toString()) as unknown;
  const playCount = countSummaryPlays(summary);
  const drives =
    isRecord(summary) && isRecord(summary['drives']) ? summary['drives']['previous'] : [];
  const prefixes = summaryPlayPrefixes(summary, playCount);
  for (const prefix of prefixes.slice(0, -1)) markInProgress(prefix);

  it('one team, no socket', async () => {
    const stats = await replay({ roster: 'one', active: false, prefixes });
    expect(stats.plays).toBe(playCount);
    expect(Array.isArray(drives) ? drives.length : 0).toBe(21);
    expect(stats.enqueued).toEqual({
      flag_added: 9,
      flag_removed: 10,
      priority_increased: 4,
    });
    expect(stats.rows).toEqual(stats.enqueued);
    expect(stats.pushes).toBe(9);
    expect(stats.rateLimited).toBe(0);
  }, 120_000);

  it('both teams', async () => {
    const stats = await replay({ roster: 'both', active: true, prefixes });
    expect(stats.plays).toBe(playCount);
    expect(stats.enqueued).toEqual({
      flag_added: 16,
      flag_removed: 16,
      priority_increased: 9,
      priority_decreased: 3,
    });
    expect(stats.rows).toEqual({
      flag_added: 16,
      flag_removed: 10,
      priority_increased: 9,
      priority_decreased: 3,
    });
    expect(stats.pushes).toBe(16);
    expect(stats.rateLimited).toBe(0);
  }, 120_000);
});

async function replay(input: {
  roster: 'one' | 'both';
  active: boolean;
  prefixes: unknown[];
}): Promise<{
  plays: number;
  enqueued: Record<string, number>;
  rows: Record<string, number>;
  pushes: number;
  rateLimited: number;
}> {
  let fetchIndex = 0;
  vi.stubGlobal('fetch', () => {
    const body = input.prefixes[Math.min(fetchIndex, input.prefixes.length - 1)];
    fetchIndex += 1;
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });

  const persistence = new InMemoryFlagEventPersistence();
  const hits: { eventId: string; at: number }[] = [];
  const rateStore: RateLimitStore = {
    async countRecentNotifications(_userId, sinceMs, untilMs) {
      return hits.filter((hit) => hit.at >= sinceMs && hit.at <= untilMs).length;
    },
    async recordNotification(_userId, eventId, at) {
      hits.push({ eventId, at });
    },
  };
  const pushes: { rowId: string; at: number }[] = [];
  const sends = new Map<string, number>();
  let failNext = true;
  let failedRowId: string | null = null;
  const clock = { now: 0, last: 0 };

  const first = await playGame({
    roster: input.roster,
    active: input.active,
    persistence,
    rateStore,
    clock,
    notifier: {
      id: 'none',
      async sendPush(payload) {
        const id = rowId(payload.data) ?? '';
        sends.set(id, (sends.get(id) ?? 0) + 1);
        if (failNext) {
          failNext = false;
          failedRowId = id;
          return { success: false, error: 'offline' };
        }
        pushes.push({ rowId: id, at: clock.now });
        return { success: true };
      },
    },
  });

  // A possession window that resolves on the real play that produced the event releases
  // on that play. Every other push waits for a later real play, and none is earlier than
  // the play that produced it.
  for (const push of pushes) {
    const row = persistence.records.find((item) => item.id === push.rowId);
    const producer = first.seen.find((play) => play.id === row?.triggeringPlayId);
    expect(producer, row?.triggeringPlayId ?? 'push').toBeDefined();
    const producedAt = producer?.at ?? Number.POSITIVE_INFINITY;
    expect(push.at).toBeGreaterThanOrEqual(producedAt);
    if (producer && classifyPlayType(producer.playType) !== 'REAL_ACTION') {
      const earliest = nextRealPlayAt(first.seen, producer.id);
      expect(earliest, producer.id).toEqual(expect.any(Number));
      expect(push.at).toBeGreaterThanOrEqual(earliest ?? Number.POSITIVE_INFINITY);
    }
  }
  expect(failedRowId).not.toBeNull();
  expect(sends.get(failedRowId ?? '')).toBe(2);
  expect(pushes.filter((push) => push.rowId === failedRowId)).toHaveLength(1);
  expect(hits).toHaveLength(new Set(hits.map((hit) => hit.eventId)).size);

  const rowsAfter = persistence.records.length;
  const pushesAfter = pushes.length;
  fetchIndex = 0;
  await playGame({
    roster: input.roster,
    active: input.active,
    persistence,
    rateStore,
    clock: { now: 0, last: 0 },
    notifier: {
      id: 'none',
      async sendPush() {
        pushes.push({ rowId: 'second', at: 0 });
        return { success: true };
      },
    },
  });
  expect(persistence.records).toHaveLength(rowsAfter);
  expect(pushes).toHaveLength(pushesAfter);

  return {
    plays: first.plays,
    enqueued: countBy(first.enqueued.map((item) => item.eventType)),
    rows: countBy(persistence.records.map((row) => row.eventType)),
    pushes: pushesAfter,
    rateLimited: first.rateLimited,
  };
}

async function playGame(input: {
  roster: 'one' | 'both';
  active: boolean;
  persistence: InMemoryFlagEventPersistence;
  rateStore: RateLimitStore;
  clock: { now: number; last: number };
  notifier: DeliveryDeps['pushNotifier'];
}): Promise<{ plays: number; seen: SeenPlay[]; enqueued: Enqueued[]; rateLimited: number }> {
  const gameState = new InMemoryGameStateStore();
  gameState.addStake(HOME_ID, USER_ID);
  if (input.roster === 'both') gameState.addStake(AWAY_ID, USER_ID);
  if (input.active) await gameState.markUserActive(USER_ID, 24 * 60 * 60 * 1000);

  const users = new InMemoryUserDirectory();
  users.setUser({
    id: USER_ID,
    subscriptionTier: 'pro',
    preferences: parsePreferences({ notificationMode: 'all' }),
    expoPushToken: 'ExponentPushToken[replay]',
  });
  const catalog = new InMemoryGameCatalog();
  catalog.setGame(GAME_ID, {
    homeTeamAbbreviation: 'GB',
    awayTeamAbbreviation: 'ATL',
    homeTeamName: 'Packers',
    awayTeamName: 'Falcons',
    homeTeamPrimaryColor: '#203731',
    homeTeamSecondaryColor: '#ffb612',
    awayTeamPrimaryColor: '#a71930',
    awayTeamSecondaryColor: '#000000',
  });

  const queue = recordingQueue();
  const gate = new ResumptionGatedDispatcher({
    queue,
    clock: () => input.clock.now,
    onGated: () => undefined,
  });
  const trackers = new Map<string, ReturnType<typeof createPlaySession>['tracker']>();
  const ceiling = new ResumptionCeiling({
    store: new InMemoryResumptionOpenStore(),
    clock: () => input.clock.now,
    onFire: (gameId) => {
      trackers.get(gameId)?.applyWallClockCeiling(input.clock.now);
    },
  });
  const positions = new Map<string, Set<'offense' | 'defense'>>([
    [HOME_ID, new Set<'offense' | 'defense'>(['offense'])],
  ]);
  const players = new Map<string, string>([['player-gb', HOME_ID]]);
  if (input.roster === 'both') {
    positions.set(AWAY_ID, new Set<'offense' | 'defense'>(['offense']));
    players.set('player-atl', AWAY_ID);
  }
  const session = createPlaySession({
    gameId: GAME_ID,
    gate,
    ceiling,
    clock: () => input.clock.now,
    onPlay: {
      lineupCache: {
        async getLineupCache(userId: string, week: number) {
          if (userId !== USER_ID) return null;
          return {
            userId,
            week,
            teamPositions: positions,
            playerToTeam: players,
            starPlayerIds: new Set<string>(),
          };
        },
      },
      gameState,
      dispatcher: gate,
      clock: () => input.clock.now,
    },
  });
  trackers.set(GAME_ID, session.tracker);

  const delivery: DeliveryDeps = {
    gameStateStore: gameState,
    gameCatalog: catalog,
    playerCatalog: new InMemoryPlayerCatalog(),
    broadcastCatalog: new InMemoryBroadcastCatalog(),
    userDirectory: users,
    persistence: input.persistence,
    realtimeBus: new InMemoryRealtimeBus(),
    rateLimitStore: input.rateStore,
    pushNotifier: input.notifier,
    clock: () => input.clock.now,
  };

  const seen: SeenPlay[] = [];
  let plays = 0;
  let rateLimited = 0;
  const source = new EspnPlaySource({
    eventId: EVENT_ID,
    pollIntervalMs: 0,
    client: espnClient,
  });
  try {
    await source.subscribe(async (raw) => {
      const play = translatePlay(raw, GAME_ID, ABBR_TO_UUID);
      const at = gameClock(play);
      input.clock.now = at > input.clock.last ? at : input.clock.last + 1;
      input.clock.last = input.clock.now;
      seen.push({ id: play.playId, at: input.clock.now, playType: play.playType });
      plays += 1;
      await session.handlePlay(play);
      const tick = await runDispatcherTick({
        queue,
        gameStateStore: gameState,
        userDirectory: users,
        rateLimitStore: input.rateStore,
        delivery,
        clock: () => input.clock.now,
      });
      rateLimited += tick.droppedRateLimited;
    });
  } finally {
    session.dispose();
    ceiling.stop();
    gate.stop();
  }

  return { plays, seen, enqueued: queue.enqueued, rateLimited };
}
