import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RESUMPTION_CEILING_MS,
  classifyPlayType,
  computeFlagState,
  type PlayEvent,
} from '@pivot/engine';
import {
  espnClient,
  espnSummarySchema,
  EspnPlaySource,
  countSummaryPlays,
  mapEspnPlay,
  resolveGameContext,
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
  realtimeUserChannel,
  InMemoryResumptionOpenStore,
  InMemoryUserDirectory,
  ResumptionCeiling,
  ResumptionGatedDispatcher,
  runDispatcherTick,
  type DeliveryDeps,
  type FlagEventQueue,
  type RateLimitStore,
} from '@pivot/dispatcher';
import {
  parsePreferences,
  type AiringNetwork,
  type FlagEvent,
  type FlagState,
} from '@pivot/shared';
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

interface ReplayAiring {
  network: AiringNetwork;
  kickoff: string;
}
const TNF_ON_PRIME: ReplayAiring = { network: 'amazon_prime', kickoff: '2026-09-25T00:15:00Z' };
const SUNDAY_ON_FOX: ReplayAiring = { network: 'fox', kickoff: '2026-09-27T17:00:00Z' };

const OFFENSE_PLAY_TYPES: ReadonlySet<PlayEvent['playType']> = new Set<PlayEvent['playType']>([
  'pass',
  'run',
  'qb_kneel',
  'qb_spike',
  'two_point_attempt',
]);

interface SentPush {
  body: string;
  action: unknown;
}

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

/** The flag Home would show: identity, whether it is on, score, and reasons. */
function flagSnapshot(state: FlagState | null | undefined): {
  gameId: string;
  flagged: boolean;
  priorityScore: number;
  reasons: FlagState['reasons'];
} | null {
  if (!state) return null;
  return {
    gameId: state.gameId,
    flagged: state.flagged,
    priorityScore: state.priorityScore,
    reasons: state.reasons,
  };
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
    const stats = await replay({ roster: 'one', active: false, prefixes, airing: TNF_ON_PRIME });
    expect(stats.plays).toBe(playCount);
    expect(Array.isArray(drives) ? drives.length : 0).toBe(21);
    // Issue #7: 10 flag_added, not 9. The second-half kickoff now nudges GB on the kickoff; before,
    // GB's first Q3 snap was dropped with the window that halftime aborted.
    expect(stats.enqueued).toEqual({
      flag_added: 10,
      flag_removed: 10,
      priority_increased: 4,
    });
    // One red-zone priority_increased (Q4 1:20) is parked until the next real play, the Q4 1:18
    // interception. That play now clears GB's flag itself, so delivery drops the older priority
    // event as superseded (`isStillRelevant`) instead of persisting it.
    expect(stats.rows).toEqual({ ...stats.enqueued, priority_increased: 3 });
    expect(stats.pushes).toBe(10);
    expect(stats.rateLimited).toBe(0);
    // TNF is Prime-only and the user has YouTube TV: every push still sends, with no option.
    expect(stats.pushed).toHaveLength(10);
    for (const push of stats.pushed) {
      expect(push.action).toEqual(
        expect.objectContaining({ recommended_source: null, deep_link_url: null }),
      );
      expect(push.body).toMatch(/ On Prime Video\.$/);
    }
  }, 120_000);

  it('the same plays on a Sunday FOX game carry a YouTube TV deep link', async () => {
    const stats = await replay({ roster: 'one', active: false, prefixes, airing: SUNDAY_ON_FOX });
    expect(stats.pushes).toBe(10);
    expect(stats.pushed).toHaveLength(10);
    for (const push of stats.pushed) {
      expect(push.action).toEqual(
        expect.objectContaining({
          recommended_source: 'youtube_tv',
          deep_link_url: 'https://tv.youtube.com/search/Falcons%20vs%20Packers%20today',
        }),
      );
      expect(push.body).toMatch(/ Find on YouTube TV\.$/);
    }
  }, 120_000);

  it('both teams', async () => {
    const stats = await replay({ roster: 'both', active: true, prefixes, airing: TNF_ON_PRIME });
    expect(stats.plays).toBe(playCount);
    // Issue #7: with both teams rostered, the flag now passes from one offense to the other on the
    // play that ends the possession, instead of clearing on the kick and coming back on the next
    // snap. So far fewer clears (4, not 17), and one more add (the second-half kickoff).
    expect(stats.enqueued).toEqual({
      flag_added: 21,
      flag_removed: 4,
      priority_increased: 9,
      priority_decreased: 1,
    });
    expect(stats.rows).toEqual({
      flag_added: 21,
      flag_removed: 1,
      priority_increased: 8,
      priority_decreased: 1,
    });
    expect(stats.pushes).toBe(21);
    expect(stats.rateLimited).toBe(0);
  }, 120_000);

  it('pushes the receiving team on the play that ends each possession (issue #7)', async () => {
    const changes = possessionEndingPlays(summary);
    // Every way a possession ends in this game: punts, interceptions, a turnover on downs, a blocked
    // field goal, and the kickoffs (opening, second half, and after each score).
    expect(countBy(changes.map((change) => change.typeText))).toEqual({
      Kickoff: 10,
      Punt: 7,
      'Pass Interception Return': 2,
      'Pass Incompletion': 1,
      'Blocked Field Goal': 1,
    });

    const game = await quietGame(prefixes);
    expectNudgeOnEveryEndingPlay(game, changes);
    // Mid-drive plays (including the two fumbles GB recovered itself) hand nothing over, so no
    // flag_added comes from them: every flag_added is one of the ending plays above.
    const addedOn = game.enqueued
      .filter((item) => item.eventType === 'flag_added')
      .map((item) => item.triggeringPlayId);
    expect(new Set(addedOn)).toEqual(new Set(changes.map((change) => change.id)));
  }, 120_000);

  it('pushes the receiving team on a lost fumble', async () => {
    // The fixture has no lost fumble. This copy makes GB's Q3 own-recovery fumble a lost one:
    // ESPN type 29 "Fumble Recovery (Opponent)", end.team ATL, and drops the rest of that GB drive
    // so ATL's drive follows. Everything else is the captured game.
    const mutated = structuredClone(summary);
    const fumbleId = loseFumble(mutated, 'Fumble Recovery (Own)');
    const changes = possessionEndingPlays(mutated);
    expect(changes.find((change) => change.id === fumbleId)?.typeText).toBe(
      'Fumble Recovery (Opponent)',
    );

    const game = await quietGame(prefixesOf(mutated));
    expectNudgeOnEveryEndingPlay(game, changes);
  }, 120_000);

  it('falls back to the next snap for a punt with 0:10 or less left in Q2', async () => {
    // A copy with GB's Q2 0:38 punt moved to 0:06.
    const mutated = structuredClone(summary);
    const puntId = retimePlay(mutated, 'Punt', '0:38', '0:06');

    const game = await quietGame(prefixesOf(mutated));

    const index = game.seen.findIndex((play) => play.id === puntId);
    const atlSnap = game.seen
      .slice(index + 1)
      .find((play) => OFFENSE_PLAY_TYPES.has(play.playType));
    const added = game.enqueued.filter((item) => item.eventType === 'flag_added');
    expect(added.some((item) => item.triggeringPlayId === puntId)).toBe(false);
    const fallback = added.find((item) => item.triggeringPlayId === atlSnap?.id);
    expect(fallback?.scheduledFireAt).toBe(atlSnap?.at);
  }, 120_000);
});

describe('ATL @ GB replay: silence ceiling', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires the nudge on the punt and still releases a held REVEAL when no play follows', async () => {
    vi.useFakeTimers();
    const summary = espnSummarySchema.parse(
      JSON.parse(gunzipSync(readFileSync(FIXTURE)).toString()) as unknown,
    );
    const context = resolveGameContext(summary, EVENT_ID);
    if (!context) throw new Error('fixture has no game context');
    const all = (summary.drives?.previous ?? []).flatMap((drive) =>
      (drive.plays ?? []).map((play) =>
        translatePlay(mapEspnPlay(play, drive, context, false), GAME_ID, ABBR_TO_UUID),
      ),
    );
    // Stop the feed right after GB's first punt (Q1 12:45): the receiving team's snap never arrives.
    const puntIndex = all.findIndex((play) => play.playType === 'punt');
    const plays = all.slice(0, puntIndex + 1);
    const punt = plays[puntIndex];
    if (!punt) throw new Error('fixture has no punt');

    const now = { value: 0 };
    const queue = recordingQueue();
    const gate = new ResumptionGatedDispatcher({
      queue,
      clock: () => now.value,
      onGated: () => undefined,
    });
    const gameState = new InMemoryGameStateStore();
    gameState.addStake(AWAY_ID, USER_ID);
    const session = createPlaySession({
      gameId: GAME_ID,
      gate,
      ceiling: new ResumptionCeiling({
        store: new InMemoryResumptionOpenStore(),
        clock: () => now.value,
        onFire: () => undefined,
      }),
      clock: () => now.value,
      onPlay: {
        lineupCache: {
          async getLineupCache(userId: string, week: number) {
            return {
              userId,
              week,
              teamPositions: new Map([[AWAY_ID, new Set<'offense' | 'defense'>(['offense'])]]),
              playerToTeam: new Map([['player-atl', AWAY_ID]]),
              starPlayerIds: new Set<string>(),
            };
          },
        },
        gameState,
        dispatcher: gate,
        clock: () => now.value,
      },
      // A stand-in REVEAL (a bet trigger) on the punt: it must wait for resumption.
      async runBetPass(play) {
        if (play.playId !== punt.playId) return;
        await gate.dispatch(
          {
            id: 'reveal',
            userId: 'bettor',
            gameId: GAME_ID,
            type: 'bet_in_play',
            oldState: null,
            newState: {
              gameId: GAME_ID,
              flagged: true,
              priorityScore: 9,
              reasons: [],
              computedAt: 0,
            },
            scheduledFireAt: 0,
          },
          play.playId,
        );
      },
    });
    try {
      for (const play of plays) {
        now.value = gameClock(play);
        await session.handlePlay(play);
      }
      const puntAt = now.value;
      expect(queue.enqueued.filter((item) => item.triggeringPlayId === punt.playId)).toEqual([
        { scheduledFireAt: puntAt, triggeringPlayId: punt.playId, eventType: 'flag_added' },
      ]);

      now.value = puntAt + RESUMPTION_CEILING_MS;
      await vi.advanceTimersByTimeAsync(RESUMPTION_CEILING_MS);

      expect(queue.enqueued.filter((item) => item.eventType === 'bet_in_play')).toEqual([
        {
          scheduledFireAt: puntAt + RESUMPTION_CEILING_MS,
          triggeringPlayId: punt.playId,
          eventType: 'bet_in_play',
        },
      ]);
    } finally {
      session.dispose();
      gate.stop();
    }
  });
});

interface EndingPlay {
  id: string;
  typeText: string;
}

/**
 * Reads the possession changes straight off ESPN's JSON, independently of the mapper: a play whose
 * `end.team` is not the team that had the ball going in (the drive's team, or on a kickoff the
 * kicker), skipping timeouts and period ends, scoring plays, and Q2/Q4 plays at 0:10 or less.
 */
function possessionEndingPlays(body: unknown): EndingPlay[] {
  const out: EndingPlay[] = [];
  const parsed = isRecord(body) ? body : {};
  const header = isRecord(parsed['header']) ? parsed['header'] : {};
  const competitions = Array.isArray(header['competitions']) ? header['competitions'] : [];
  const competitors =
    isRecord(competitions[0]) && Array.isArray(competitions[0]['competitors'])
      ? competitions[0]['competitors'].filter(isRecord)
      : [];
  const ids = competitors.map((competitor) => String(competitor['id']));
  const drives =
    isRecord(parsed['drives']) && Array.isArray(parsed['drives']['previous'])
      ? parsed['drives']['previous'].filter(isRecord)
      : [];
  let score = '0-0';
  for (const drive of drives) {
    const driveTeam = isRecord(drive['team']) ? String(drive['team']['id']) : '';
    const plays = Array.isArray(drive['plays']) ? drive['plays'].filter(isRecord) : [];
    for (const play of plays) {
      const type = isRecord(play['type']) ? play['type'] : {};
      const typeText = String(type['text'] ?? '');
      const playScore = `${String(play['homeScore'])}-${String(play['awayScore'])}`;
      const scored = playScore !== score;
      score = playScore;
      if (/timeout|end period|end of half|end of game|two-minute|penalty/i.test(typeText)) continue;
      const end =
        isRecord(play['end']) && isRecord(play['end']['team'])
          ? String(play['end']['team']['id'])
          : null;
      const before = typeText === 'Kickoff' ? ids.find((id) => id !== driveTeam) : driveTeam;
      if (end === null || end === before || scored) continue;
      const period = isRecord(play['period']) ? Number(play['period']['number']) : 0;
      const clock = isRecord(play['clock']) ? String(play['clock']['displayValue']) : '';
      const [minutes, seconds] = clock.split(':').map(Number);
      const left = (minutes ?? 0) * 60 + (seconds ?? 0);
      if ((period === 2 || period === 4) && left <= 10) continue;
      out.push({ id: String(play['id']), typeText });
    }
  }
  return out;
}

/** Each ending play enqueued a `flag_added` for the receiving team, timed at that play's arrival. */
function expectNudgeOnEveryEndingPlay(
  game: { seen: SeenPlay[]; enqueued: Enqueued[] },
  changes: readonly EndingPlay[],
): void {
  for (const change of changes) {
    const seenAt = game.seen.find((play) => play.id === change.id)?.at;
    const pushed = game.enqueued.find(
      (item) => item.eventType === 'flag_added' && item.triggeringPlayId === change.id,
    );
    expect(pushed?.scheduledFireAt, `${change.typeText} ${change.id}`).toBe(seenAt);
  }
}

function drivesOf(body: unknown): Record<string, unknown>[] {
  if (!isRecord(body) || !isRecord(body['drives'])) return [];
  const previous = body['drives']['previous'];
  return Array.isArray(previous) ? previous.filter(isRecord) : [];
}

function playsOf(drive: Record<string, unknown>): Record<string, unknown>[] {
  const plays = drive['plays'];
  return Array.isArray(plays) ? plays.filter(isRecord) : [];
}

/** Turns the first play with this type text into a fumble lost to ATL and ends its drive there. */
function loseFumble(body: unknown, typeText: string): string {
  for (const drive of drivesOf(body)) {
    const plays = playsOf(drive);
    const index = plays.findIndex(
      (play) => isRecord(play['type']) && play['type']['text'] === typeText,
    );
    const play = plays[index];
    if (!play) continue;
    play['type'] = { id: '29', text: 'Fumble Recovery (Opponent)' };
    play['end'] = { team: { id: '1' } };
    drive['plays'] = plays.slice(0, index + 1);
    return String(play['id']);
  }
  throw new Error(`no ${typeText} play`);
}

/** Moves the first play with this type text and clock to a new clock. */
function retimePlay(body: unknown, typeText: string, from: string, to: string): string {
  for (const drive of drivesOf(body)) {
    for (const play of playsOf(drive)) {
      const type = isRecord(play['type']) ? play['type']['text'] : undefined;
      const clock = isRecord(play['clock']) ? play['clock']['displayValue'] : undefined;
      if (type !== typeText || clock !== from) continue;
      play['clock'] = { displayValue: to };
      return String(play['id']);
    }
  }
  throw new Error(`no ${typeText} at ${from}`);
}

function prefixesOf(body: unknown): unknown[] {
  const list = summaryPlayPrefixes(body, countSummaryPlays(body));
  for (const prefix of list.slice(0, -1)) markInProgress(prefix);
  return list;
}

/** One pass with both teams rostered, no rate limit, and a notifier that always succeeds. */
async function quietGame(
  gamePrefixes: unknown[],
): Promise<{ plays: number; seen: SeenPlay[]; enqueued: Enqueued[]; rateLimited: number }> {
  let fetchIndex = 0;
  vi.stubGlobal('fetch', () => {
    const body = gamePrefixes[Math.min(fetchIndex, gamePrefixes.length - 1)];
    fetchIndex += 1;
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
  return playGame({
    roster: 'both',
    active: true,
    airing: TNF_ON_PRIME,
    persistence: new InMemoryFlagEventPersistence(),
    rateStore: {
      async countRecentNotifications() {
        return 0;
      },
      recordNotification: () => Promise.resolve(),
    },
    clock: { now: 0, last: 0 },
    notifier: {
      id: 'none',
      async sendPush() {
        return { success: true };
      },
    },
    checkPublished: false,
  });
}

async function replay(input: {
  roster: 'one' | 'both';
  active: boolean;
  prefixes: unknown[];
  airing: ReplayAiring;
}): Promise<{
  plays: number;
  enqueued: Record<string, number>;
  rows: Record<string, number>;
  pushes: number;
  pushed: SentPush[];
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
  const pushed: SentPush[] = [];
  const sends = new Map<string, number>();
  let failNext = true;
  let failedRowId: string | null = null;
  const clock = { now: 0, last: 0 };

  const first = await playGame({
    roster: input.roster,
    active: input.active,
    airing: input.airing,
    persistence,
    rateStore,
    clock,
    checkPublished: true,
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
        pushed.push({
          body: payload.body,
          action: isRecord(payload.data) ? payload.data['action'] : undefined,
        });
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
    airing: input.airing,
    persistence,
    rateStore,
    clock: { now: 0, last: 0 },
    checkPublished: false,
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
    pushed,
    rateLimited: first.rateLimited,
  };
}

async function playGame(input: {
  roster: 'one' | 'both';
  active: boolean;
  airing: ReplayAiring;
  persistence: InMemoryFlagEventPersistence;
  rateStore: RateLimitStore;
  clock: { now: number; last: number };
  notifier: DeliveryDeps['pushNotifier'];
  /** The dedupe pass publishes nothing new; only the first pass has a flag stream to compare. */
  checkPublished: boolean;
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

  const broadcasts = new InMemoryBroadcastCatalog();
  broadcasts.setWeekAirings([
    {
      id: GAME_ID,
      kickoff: new Date(input.airing.kickoff),
      airings: [
        {
          network: input.airing.network,
          market: 'national',
          espnMediaName: input.airing.network.toUpperCase(),
          espnType: 'TV',
        },
      ],
    },
  ]);
  broadcasts.setUserSubscribedServices(USER_ID, ['youtube_tv']);

  const realtime = new InMemoryRealtimeBus();
  const delivery: DeliveryDeps = {
    gameStateStore: gameState,
    gameCatalog: catalog,
    playerCatalog: new InMemoryPlayerCatalog(),
    broadcastCatalog: broadcasts,
    userDirectory: users,
    persistence: input.persistence,
    realtimeBus: realtime,
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

  const finalGame = await gameState.getGameState(GAME_ID);
  if (!finalGame) throw new Error('replay produced no game state');
  const expected = computeFlagState(
    {
      userId: USER_ID,
      week: 3,
      teamPositions: positions,
      playerToTeam: players,
      starPlayerIds: new Set<string>(),
    },
    finalGame,
    () => input.clock.now,
  );
  const stored = await gameState.getUserFlagState(USER_ID, GAME_ID);
  expect(flagSnapshot(stored)).toEqual(flagSnapshot(expected));
  if (!input.checkPublished) return { plays, seen, enqueued: queue.enqueued, rateLimited };

  const published = realtime.published
    .filter((item) => item.channel === realtimeUserChannel(USER_ID))
    .map((item) => item.message)
    .filter(isRecord)
    .filter((message) => message['type'] === 'flag_event')
    .at(-1);
  const payload = published && isRecord(published['payload']) ? published['payload'] : null;
  const newState = payload && isRecord(payload['new_state']) ? payload['new_state'] : null;
  expect(flagSnapshot(newState as FlagState | null)).toEqual(flagSnapshot(expected));

  return { plays, seen, enqueued: queue.enqueued, rateLimited };
}
