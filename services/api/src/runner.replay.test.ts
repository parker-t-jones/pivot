import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IncrementalResumptionTracker,
  onPlayEvent,
  type PlayEvent,
  type ResumptionResolution,
} from '@pivot/engine';
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
  InMemoryUserDirectory,
  ResumptionGatedDispatcher,
  runDispatcherTick,
  type DeliveryDeps,
  type FlagEventQueue,
  type RateLimitStore,
} from '@pivot/dispatcher';
import { parsePreferences, type FlagEvent } from '@pivot/shared';

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

interface Release {
  outcome: ResumptionResolution['outcome'];
  openAt: number;
  resolveAt: number;
}

interface Enqueued {
  scheduledFireAt: number;
  triggeringPlayId: string | null;
  eventType: FlagEvent['type'];
  resolution: ResumptionResolution | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The captured body is already final. Earlier prefixes must stay in progress or the source stops. */
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

function releaseCovering(releases: readonly Release[], at: number): Release | undefined {
  return releases.find(
    (release) => release.outcome !== 'ABORTED' && at >= release.openAt && at <= release.resolveAt,
  );
}

function maxInWindow(times: readonly number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  let max = 0;
  let start = 0;
  for (let end = 0; end < sorted.length; end += 1) {
    const latest = sorted[end] ?? 0;
    while (latest - (sorted[start] ?? 0) > 60_000) start += 1;
    max = Math.max(max, end - start + 1);
  }
  return max;
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
        resolution: null,
      });
      await inner.enqueue(event, triggeringPlayId);
    },
    due: (now, limit) => inner.due(now, limit),
    remove: (item) => inner.remove(item),
  };
}

describe('ATL @ GB replay', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('replays the recorded game through the live pipeline', async () => {
    const summary = JSON.parse(gunzipSync(readFileSync(FIXTURE)).toString()) as unknown;
    const playCount = countSummaryPlays(summary);
    const drives =
      isRecord(summary) && isRecord(summary['drives']) ? summary['drives']['previous'] : [];
    const driveCount = Array.isArray(drives) ? drives.length : 0;
    expect(driveCount).toBe(21);
    expect(playCount).toBe(184);

    const prefixes = summaryPlayPrefixes(summary, playCount);
    for (const prefix of prefixes.slice(0, -1)) markInProgress(prefix);
    let fetchIndex = 0;
    vi.stubGlobal('fetch', () => {
      const body = prefixes[Math.min(fetchIndex, prefixes.length - 1)];
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
      persistence,
      rateStore,
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
      clock,
    });

    // 21 completed drives. The first has no prior possession, so the tracker opens 20 windows.
    // Halftime aborts one. 19 resolve REAL_ACTION. That is the possession-change derivation.
    // This user is on offense for both teams, one player each, so a possession flip keeps
    // priority at 2 and emits nothing. The gate enqueues 16 flag_added, 17 flag_removed,
    // 9 priority_increased, and 3 priority_decreased. Only flag_added pushes or counts
    // against the rate limit, and this game stays under 3 flag_added per 60s, so all 45
    // events are delivered and 16 pushes go out.
    const windowsOpened = driveCount - 1;
    const abortedWindows = 1;
    const resolvedWindows = windowsOpened - abortedWindows;
    expect(first.opened).toBe(windowsOpened);
    expect(first.aborted).toBe(abortedWindows);
    expect(first.real).toBe(resolvedWindows);
    expect(first.ceiling).toBe(0);
    expect(first.plays).toBe(playCount);

    const byType = new Map<string, number>();
    for (const item of first.enqueued) {
      byType.set(item.eventType, (byType.get(item.eventType) ?? 0) + 1);
    }
    expect(Object.fromEntries(byType)).toEqual({
      flag_added: 16,
      flag_removed: 17,
      priority_increased: 9,
      priority_decreased: 3,
    });
    expect(first.dropped).toEqual({ stale: 0, rate: 0, delivered: 45 });
    expect(persistence.records).toHaveLength(45);
    expect(pushes).toHaveLength(16);
    expect(hits).toHaveLength(16);

    expect(failedRowId).not.toBeNull();
    expect(sends.get(failedRowId ?? '')).toBe(2);
    expect(pushes.filter((push) => push.rowId === failedRowId)).toHaveLength(1);
    expect(hits).toHaveLength(new Set(hits.map((hit) => hit.eventId)).size);
    expect(maxInWindow(hits.map((hit) => hit.at))).toBeLessThanOrEqual(3);
    expect(maxInWindow(pushes.map((push) => push.at))).toBeLessThanOrEqual(3);

    for (const item of first.enqueued) {
      const producedAt = first.playAt.get(item.triggeringPlayId ?? '');
      const release = releaseCovering(first.releases, item.scheduledFireAt);
      if (release) {
        expect(item.scheduledFireAt).toBeGreaterThanOrEqual(release.openAt);
        expect(item.scheduledFireAt).toBeLessThanOrEqual(release.resolveAt);
      } else {
        expect(item.scheduledFireAt).toBe(producedAt);
      }
      expect(item.scheduledFireAt).not.toBe((producedAt ?? 0) + 75_000);
      expect(item.scheduledFireAt).not.toBe((producedAt ?? 0) + 60_000);
    }
    for (const row of persistence.records) {
      expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(row.triggeringPlayId).not.toBeNull();
      const release = releaseCovering(first.releases, row.firedAt);
      if (release) {
        expect(row.firedAt).toBeGreaterThanOrEqual(release.openAt);
        expect(row.firedAt).toBeLessThanOrEqual(release.resolveAt);
      } else {
        expect(row.firedAt).toBe(first.playAt.get(row.triggeringPlayId ?? ''));
      }
    }
    for (const push of pushes) {
      const row = persistence.records.find((item) => item.id === push.rowId);
      expect(row).toBeDefined();
      const openAt = releaseCovering(first.releases, row?.firedAt ?? 0)?.openAt;
      const producedAt = first.playAt.get(row?.triggeringPlayId ?? '');
      expect(push.at).toBeGreaterThanOrEqual(openAt ?? producedAt ?? Number.POSITIVE_INFINITY);
    }

    const rowsAfterFirst = persistence.records.length;
    const pushesAfterFirst = pushes.length;
    const hitsAfterFirst = hits.length;
    fetchIndex = 0;
    await playGame({
      persistence,
      rateStore,
      notifier: {
        id: 'none',
        async sendPush() {
          pushes.push({ rowId: 'second', at: 0 });
          return { success: true };
        },
      },
      clock: { now: 0, last: 0 },
    });
    expect(persistence.records).toHaveLength(rowsAfterFirst);
    expect(pushes).toHaveLength(pushesAfterFirst);
    expect(hits).toHaveLength(hitsAfterFirst);
  }, 120_000);
});

async function playGame(input: {
  persistence: InMemoryFlagEventPersistence;
  rateStore: RateLimitStore;
  notifier: DeliveryDeps['pushNotifier'];
  clock: { now: number; last: number };
}): Promise<{
  opened: number;
  real: number;
  aborted: number;
  ceiling: number;
  releases: Release[];
  playAt: Map<string, number>;
  enqueued: Enqueued[];
  plays: number;
  dropped: { stale: number; rate: number; delivered: number };
}> {
  const gameState = new InMemoryGameStateStore();
  gameState.addStake(HOME_ID, USER_ID);
  gameState.addStake(AWAY_ID, USER_ID);
  await gameState.markUserActive(USER_ID, 24 * 60 * 60 * 1000);

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
  const releases: Release[] = [];
  let pendingOpen: { at: number } | null = null;
  let opened = 0;
  const gate = new ResumptionGatedDispatcher({
    queue,
    clock: () => input.clock.now,
    onGated: (record) => {
      const last = queue.enqueued[queue.enqueued.length - 1];
      if (last && last.resolution === null && record.decision !== 'dropped_by_abort') {
        last.resolution = record.resolution;
      }
    },
  });
  const tracker = new IncrementalResumptionTracker(GAME_ID, {
    onWindowOpened: (gameId, window) => {
      opened += 1;
      pendingOpen = { at: window.revealingPlay.observedAt };
      gate.noteWindowOpened(gameId);
    },
    onResolved: (gameId, resolution) => {
      releases.push({
        outcome: resolution.outcome,
        openAt: pendingOpen?.at ?? input.clock.now,
        resolveAt: input.clock.now,
      });
      pendingOpen = null;
      void gate.noteResolution(gameId, resolution);
    },
  });

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

  const playAt = new Map<string, number>();
  let plays = 0;
  const dropped = { stale: 0, rate: 0, delivered: 0 };
  const source = new EspnPlaySource({
    eventId: EVENT_ID,
    pollIntervalMs: 0,
    client: espnClient,
  });
  await source.subscribe(async (raw) => {
    const play = translatePlay(raw, GAME_ID, ABBR_TO_UUID);
    const at = gameClock(play);
    input.clock.now = at > input.clock.last ? at : input.clock.last + 1;
    input.clock.last = input.clock.now;
    playAt.set(play.playId, input.clock.now);
    plays += 1;
    gate.beginPlay(play.gameId);
    tracker.observe(play, input.clock.now);
    await onPlayEvent(
      {
        lineupCache: {
          async getLineupCache(userId: string, week: number) {
            if (userId !== USER_ID) return null;
            return {
              userId,
              week,
              teamPositions: new Map([
                [HOME_ID, new Set<'offense' | 'defense'>(['offense'])],
                [AWAY_ID, new Set<'offense' | 'defense'>(['offense'])],
              ]),
              playerToTeam: new Map([
                ['player-gb', HOME_ID],
                ['player-atl', AWAY_ID],
              ]),
              starPlayerIds: new Set<string>(),
            };
          },
        },
        gameState,
        dispatcher: gate,
        clock: () => input.clock.now,
      },
      play,
    );
    await gate.endPlay(play.gameId);
    await runDispatcherTick({
      queue,
      gameStateStore: gameState,
      userDirectory: users,
      rateLimitStore: input.rateStore,
      delivery,
      clock: () => input.clock.now,
    }).then((result) => {
      dropped.stale += result.droppedStale;
      dropped.rate += result.droppedRateLimited;
      dropped.delivered += result.delivered;
    });
  });

  return {
    opened,
    real: releases.filter((release) => release.outcome === 'REAL_ACTION').length,
    aborted: releases.filter((release) => release.outcome === 'ABORTED').length,
    ceiling: releases.filter((release) => release.outcome === 'CEILING_FALLBACK').length,
    releases,
    playAt,
    enqueued: queue.enqueued,
    plays,
    dropped,
  };
}
