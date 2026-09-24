/**
 * THROWAWAY TEST HARNESS — not part of the Pivot app, not production code.
 *
 * First live-feed test of resumption detection, on a real multi-game NFL Sunday slate.
 *
 * Everything about the firing path here is the real, already-validated code: `EspnPlaySource` polls,
 * `mapEspnPlay` normalizes, `onPlayEvent` computes flag state, `watchForResumption` decides when play
 * resumed, and `runDispatcherTick` -> `isStillRelevant` -> `deliverFlagEvent` -> `ExpoPushNotifier`
 * delivers. Only two things are new (`incrementalResumption.ts`, `resumptionGate.ts`) and only the
 * things that structurally cannot run outside production are shimmed.
 *
 * WHY A HARNESS AND NOT A SERVICE. Nothing in the repo wires ingestion -> engine -> dispatcher into a
 * runnable process; `services/{engine,ingestion,dispatcher}` have no `dev` or `start` script, and the
 * full pipeline is assembled exactly once, in `dispatcher.integration.test.ts`, under fake timers.
 * This file is that assembly against a live feed and a real phone. Building it as a service instead
 * would require the Postgres adapters, the ESPN-abbreviation -> team-UUID mapping, and a real
 * answer to app-background liveness — none of which are prerequisites for learning whether the
 * resumption algorithm survives an incrementally-arriving multi-game feed.
 *
 * THE FOUR SHIMS, and the production blocker each one stands in for:
 *
 *  1. STAKES KEYED BY ESPN ABBREVIATION. `EspnPlaySource` emits `homeTeamId`/`awayTeamId` as
 *     abbreviations ('KC'), while real lineup stakes are keyed by `teams.id` UUIDs, so
 *     `getUsersWithStakeIn('KC')` would match nothing in production. Because every provider here is
 *     in-memory, the keys only have to agree with each other — seeding stakes by abbreviation
 *     sidesteps the mismatch entirely instead of building a mapping layer the test does not need.
 *
 *  2. LIVENESS IS ASSERTED, NOT OBSERVED. `isStillRelevant` requires `userIsActive`, and the app tears
 *     its WebSocket down on `background`, which makes the API call `removeActiveUser` immediately —
 *     so putting the phone down to watch TV would drop every queued event. This harness owns its own
 *     `InMemoryGameStateStore` and re-marks the user active on a timer, so the app's socket lifecycle
 *     cannot reach it. That is a shim, not a fix: real background liveness is unsolved.
 *
 *  3. RATE LIMITING IS MEASURED, NOT ENFORCED. `shouldRateLimit` allows 3 notifications per 60s per
 *     USER, with no game dimension — on a multi-game slate that silently eats events, and a silently
 *     dropped notification is indistinguishable from a resumption bug. `MeasuringRateLimitStore`
 *     always answers "not limited" but logs every event production would have dropped, so the policy
 *     question is answered with data instead of being hidden.
 *
 *  4. IN-MEMORY CATALOGS. No Postgres adapter exists for `BroadcastCatalog`, `GameCatalog`,
 *     `PlayerCatalog`, `UserDirectory`, or `FlagEventPersistence`. They are seeded at startup from
 *     each game's ESPN context plus a synthetic lineup.
 *
 * WATCHED VS DATA-ONLY GAMES. Ground truth only exists for games actually on screen, so pushes are
 * restricted to `--watch`. That is enforced through the real code path rather than a special case:
 * watched games' stakes belong to a user WITH an Expo push token, data-only games' stakes belong to a
 * second user WITHOUT one, and `deliverFlagEvent` already skips push when the token is null. As a
 * bonus the per-user rate-limit window stops data-only games from consuming the watched user's quota.
 *
 * CORRELATING LOGS WITH THE BROADCAST. `PlayEvent` carries no play text (`mapEspnPlay` drops it), so
 * plays are fingerprinted by quarter, game clock, down, distance, yards-to-endzone and score. The
 * game clock is the useful one: it is visible on the broadcast overlay in the screen recording, which
 * makes the join independent of any wall clock. `wall` timestamps come from the same machine as the
 * on-screen millisecond clock, which is what removes the clock-drift correction the Aug 29
 * measurement needed.
 *
 * Usage:
 *   npx tsx experiments/live-sunday-harness.ts --list
 *   npx tsx experiments/live-sunday-harness.ts --watch 401872659,401872922 --data auto
 *
 *   # Dry run against a COMPLETED game. --replay-delay spaces the replayed plays out past the 500ms
 *   # dispatcher tick; without it the freshness gate correctly drops all but the last event and
 *   # delivery/push go essentially untested.
 *   npx tsx experiments/live-sunday-harness.ts --watch 401872656 --replay-delay 1500 --no-push
 *
 * Flags:
 *   --watch a,b        ESPN event ids that are on screen. Resume-gated AND pushed.
 *   --data a,b|auto    ESPN event ids logged but never pushed. `auto` = rest of today's slate.
 *   --poll ms          ESPN poll interval, default 5000.
 *   --replay-delay ms  Pause after each play. Dry runs only; leave unset for a live slate.
 *   --no-push          Use the no-op push driver. The push path still runs and logs its payload.
 *   --list             Print today's scoreboard with event ids, then exit.
 *
 * Env:
 *   PIVOT_EXPO_PUSH_TOKEN   ExponentPushToken[...] for the phone under test (required unless --no-push)
 */

import { appendFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACTIVE_USER_TTL_MS,
  InMemoryBroadcastCatalog,
  InMemoryFlagEventQueue,
  InMemoryGameCatalog,
  InMemoryGameStateStore,
  InMemoryPlayerCatalog,
  InMemoryRealtimeBus,
  InMemoryUserDirectory,
  createPushNotifier,
  startDispatcherLoop,
  type DeliveryDeps,
  type DispatchUser,
  type DispatcherTickDeps,
  type FlagEventPersistence,
  type PersistedFlagEventInput,
  type PushNotifier,
  type PushPayload,
  type PushResult,
  type RateLimitStore,
} from '@pivot/dispatcher';
import {
  classifyPlayType,
  onPlayEvent,
  type LineupCacheReader,
  type OnPlayEventDeps,
  type PlayEvent,
} from '@pivot/engine';
import {
  EspnPlaySource,
  espnClient,
  resolveGameContext,
  type EspnClient,
  type EspnFetchResult,
  type EspnGameContext,
  type EspnSummary,
} from '@pivot/ingestion';
import type { UserLineupCache } from '@pivot/shared';

import { IncrementalResumptionTracker, type ResumptionResolution } from './incrementalResumption.js';
import { teamInfo } from './nflTeams.js';
import { ResumptionGatedDispatcher, type GatedEventRecord } from './resumptionGate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(__dirname, 'logs');

const WATCHED_USER_ID = 'harness-watched-user';
const DATA_ONLY_USER_ID = 'harness-dataonly-user';
/** YouTube TV's live entry point — fallback for any game without a known per-broadcast videoId. */
const YOUTUBE_TV_DEEP_LINK = 'https://tv.youtube.com/live';
/**
 * Per-game YouTube TV `videoId`s, hand-captured from the browser address bar while each broadcast
 * was live (see PLAN.md's deep-link open question: `tv.youtube.com/watch/<videoId>` opens directly
 * into the live game, but the videoId isn't derivable from the matchup — it has to come from
 * somewhere per-broadcast). Filled in only for today's watched games; anything absent here falls
 * back to `YOUTUBE_TV_DEEP_LINK` (opens YouTube TV's home/live tab instead of the exact game).
 */
const GAME_VIDEO_IDS: Readonly<Record<string, string>> = {
  '401872661': '_XYzBeHLxpU', // Bears (CAR @ CHI)
  '401872660': 'skeSQ9ZXBXc', // Bills (HOU @ BUF)
  '401872931': 'MrXg0chrojg', // MNF (DEN @ KC)
};
/**
 * Overrides which team's offense the watched user is staked in, keyed by gameId. Defaults to
 * `context.homeTeamId` (see `stakeTeamFor`) when a game has no entry here.
 *
 * Only one team per game — never both — is staked (see `buildLineup`'s doc comment: staking both
 * sides of a game keeps `flagged` permanently `true` across every possession change, so
 * `diffFlagStates` never toggles and no event fires at all). A single stake already notifies on
 * *every* possession change in a two-team game: `flag_added` when the staked team takes over,
 * `flag_removed` (with "<other team> has the ball now" copy) when the other team does. So staking
 * HOU in 401872660 already covers both "Bills coming on offense" and "Texans coming on offense" —
 * only 401872661 needs an override, to point the stake at CHI instead of the default home team CAR.
 */
const STAKE_TEAM_OVERRIDES: Readonly<Record<string, string>> = {
  '401872661': 'CHI', // Bears — user wants flags on Chicago's offense, not Carolina's.
};

function stakeTeamFor(context: EspnGameContext): string {
  return STAKE_TEAM_OVERRIDES[context.gameId] ?? context.homeTeamId;
}
/**
 * Stand-in token for a no-push run. `deliverFlagEvent` skips the push branch entirely when the token
 * is `null`, so nulling it would hide the exact thing a dry run wants to inspect — the title, body and
 * deep link that would have been sent. `NoOpPushNotifier` logs the payload without validating the
 * token, so a placeholder keeps that path exercised.
 */
const DRY_RUN_PUSH_TOKEN = 'ExponentPushToken[harness-dry-run]';
/** Re-mark liveness well inside `ACTIVE_USER_TTL_MS` so a slow tick can never expire the user. */
const LIVENESS_REFRESH_MS = 60_000;
/** Grace period after the last game goes final, so in-flight queue entries still drain. */
const DRAIN_MS = 10_000;
/** How often per-game ESPN poll health is summarized into the events log. */
const ESPN_HEALTH_INTERVAL_MS = 60_000;

// --------------------------------------------------------------------------------------------
// Config
// --------------------------------------------------------------------------------------------

interface HarnessConfig {
  mode: 'list' | 'run';
  watchedGameIds: string[];
  dataOnlyGameIds: string[];
  /** `true` when `--data auto` asked us to fill data-only games from today's scoreboard. */
  autoFillDataGames: boolean;
  pollIntervalMs: number;
  /** Real Expo token, or `null` to run the push path against the no-op driver. */
  pushToken: string | null;
  /**
   * Artificial pause after each play, for replaying a COMPLETED game (see `--replay-delay` in the
   * usage notes). A finished game's plays all arrive in one poll, and each one overwrites
   * `user_flag_state`, so `isStillRelevant`'s freshness gate correctly drops every queued event except
   * the last — a measured 37 of 38 on the first dry run. Spacing the plays past the 500ms dispatcher
   * tick lets delivery and push actually run. Irrelevant (and left at 0) for a live slate, where real
   * plays are tens of seconds apart.
   */
  replayDelayMs: number;
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseArgs(argv: string[]): HarnessConfig {
  const flags = new Map<string, string>();
  const bare = new Set<string>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags.set(key, next);
      i += 1;
    } else {
      bare.add(key);
    }
  }

  const dataRaw = flags.get('data');
  const noPush = bare.has('no-push');

  return {
    mode: bare.has('list') ? 'list' : 'run',
    watchedGameIds: parseList(flags.get('watch')),
    dataOnlyGameIds: dataRaw === 'auto' ? [] : parseList(dataRaw),
    autoFillDataGames: dataRaw === 'auto',
    pollIntervalMs: Number(flags.get('poll') ?? 5000),
    pushToken: noPush ? null : (process.env['PIVOT_EXPO_PUSH_TOKEN'] ?? null),
    replayDelayMs: Number(flags.get('replay-delay') ?? 0),
  };
}

// --------------------------------------------------------------------------------------------
// Logging
// --------------------------------------------------------------------------------------------

/**
 * Append-only JSONL writer.
 *
 * Synchronous on purpose. An earlier version chained async appends and never awaited them, which lost
 * every buffered line the first time the process exited abruptly — the captured data is the entire
 * point of this run, so durability beats throughput here. The cost is nil: lines are tiny, there are a
 * few thousand across a whole slate, and the poll loop is idle on a 5s timer between them.
 */
class JsonlLog {
  constructor(private readonly filePath: string) {}

  write(record: Record<string, unknown>): void {
    const line = `${JSON.stringify({ wall: Date.now(), ...record })}\n`;
    try {
      appendFileSync(this.filePath, line, 'utf8');
    } catch (error) {
      console.error(`[harness] log write failed: ${String(error)}`);
    }
  }
}

function stamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function clockLabel(play: PlayEvent): string {
  const minutes = Math.floor(play.secondsRemainingInQuarter / 60);
  const seconds = play.secondsRemainingInQuarter % 60;
  return `Q${play.quarter} ${minutes}:${String(seconds).padStart(2, '0')}`;
}

// --------------------------------------------------------------------------------------------
// Shimmed providers
// --------------------------------------------------------------------------------------------

/** Shim 3: always answers "not limited", but logs what production would have dropped. */
class MeasuringRateLimitStore implements RateLimitStore {
  private readonly delivered = new Map<string, number[]>();
  /** Mirrors `rateLimiter.ts`'s threshold so the measurement matches the real policy. The 60s window
   *  itself arrives as `sinceMs`/`untilMs` from `shouldRateLimit`, so it isn't duplicated here. */
  private static readonly MAX_PER_WINDOW = 3;

  constructor(private readonly onWouldLimit: (userId: string, recentCount: number) => void) {}

  async countRecentNotifications(userId: string, sinceMs: number, untilMs: number): Promise<number> {
    const recent = (this.delivered.get(userId) ?? []).filter(
      (at) => at >= sinceMs && at <= untilMs,
    ).length;
    if (recent >= MeasuringRateLimitStore.MAX_PER_WINDOW) {
      this.onWouldLimit(userId, recent);
    }
    return 0;
  }

  async recordNotification(userId: string, _eventId: string, deliveredAtMs: number): Promise<void> {
    const entries = this.delivered.get(userId) ?? [];
    entries.push(deliveredAtMs);
    this.delivered.set(userId, entries);
  }
}

/** Captures the `firedAt`/`deliveredAt` pair `deliverFlagEvent` computes, which is the measured data. */
class LoggingFlagEventPersistence implements FlagEventPersistence {
  constructor(private readonly onPersist: (input: PersistedFlagEventInput) => void) {}

  async persistFlagEvent(input: PersistedFlagEventInput): Promise<void> {
    this.onPersist(input);
  }
}

/**
 * Wraps the real notifier so the Expo ticket outcome per event lands in the log. `deliverFlagEvent`
 * only `console.error`s failures, and a push that silently failed would otherwise look identical to
 * one that arrived.
 */
class LoggingPushNotifier implements PushNotifier {
  readonly id: PushNotifier['id'];

  constructor(
    private readonly inner: PushNotifier,
    private readonly onResult: (eventId: string | null, payload: PushPayload, result: PushResult) => void,
  ) {
    this.id = inner.id;
  }

  async sendPush(payload: PushPayload): Promise<PushResult> {
    const result = await this.inner.sendPush(payload);
    const data = payload.data as { event_id?: string } | null;
    this.onResult(data?.event_id ?? null, payload, result);
    return result;
  }
}

/**
 * Wraps `espnClient.getSummary` so ESPN's health across N concurrent pollers is measured.
 *
 * Worth the indirection because it is one of the multi-game unknowns this run exists to answer. A
 * 14-game slate at a 5s interval is ~2.8 requests/sec sustained for three hours against an
 * undocumented endpoint, and `EspnPlaySource` responds to a failed poll by retrying on the same
 * interval with no backoff — so throttling would show up as a slow degradation, not a crash. Without
 * this the only trace would be `console.error` lines scrolling past in a terminal.
 *
 * Failures are logged individually; successes are aggregated (see `pollStats`) so ~30k successful
 * polls don't bury the interesting rows.
 */
class InstrumentedEspnClient implements Pick<EspnClient, 'getSummary'> {
  constructor(
    private readonly onPoll: (ok: boolean, latencyMs: number, kind: string | null, reason: string | null) => void,
  ) {}

  async getSummary(eventId: string): Promise<EspnFetchResult<EspnSummary>> {
    const started = Date.now();
    const result = await espnClient.getSummary(eventId);
    this.onPoll(
      result.ok,
      Date.now() - started,
      result.ok ? null : result.kind,
      result.ok ? null : result.reason,
    );
    return result;
  }
}

/** Rolling per-game poll counters, flushed to the log on an interval as `espn_health` rows. */
class PollStats {
  private readonly latencies: number[] = [];
  private failures = 0;

  record(ok: boolean, latencyMs: number): void {
    this.latencies.push(latencyMs);
    if (!ok) this.failures += 1;
  }

  /** Returns the window's summary and resets, so each row covers only the interval since the last. */
  drain(): { polls: number; failures: number; p50Ms: number; maxMs: number } | null {
    if (this.latencies.length === 0) return null;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const summary = {
      polls: this.latencies.length,
      failures: this.failures,
      p50Ms: sorted[Math.floor(sorted.length / 2)] ?? 0,
      maxMs: sorted[sorted.length - 1] ?? 0,
    };
    this.latencies.length = 0;
    this.failures = 0;
    return summary;
  }
}

/** Week is ignored on purpose: ESPN's `header.week` is phase-relative, and a mismatch here would
 *  silently produce zero events for the whole run. The observed week is logged instead. */
class FixedLineupCache implements LineupCacheReader {
  constructor(private readonly byUser: Map<string, UserLineupCache>) {}

  async getLineupCache(userId: string, _week: number): Promise<UserLineupCache | null> {
    return this.byUser.get(userId) ?? null;
  }
}

// --------------------------------------------------------------------------------------------
// Startup helpers
// --------------------------------------------------------------------------------------------

interface ScoreboardGame {
  eventId: string;
  home: string;
  away: string;
  state: string;
}

async function fetchScoreboard(): Promise<ScoreboardGame[]> {
  const result = await espnClient.getScoreboard();
  if (!result.ok) {
    throw new Error(`ESPN scoreboard failed (${result.kind}): ${result.reason}`);
  }
  return (result.data.events ?? []).map((event) => {
    const competitors = event.competitions?.[0]?.competitors ?? [];
    return {
      eventId: event.id,
      home: competitors.find((c) => c.homeAway === 'home')?.team?.abbreviation ?? '??',
      away: competitors.find((c) => c.homeAway === 'away')?.team?.abbreviation ?? '??',
      state: event.status?.type?.state ?? 'unknown',
    };
  });
}

/** One summary fetch per game so catalogs, stakes and lineups can be seeded before plays arrive. */
async function resolveContexts(gameIds: string[]): Promise<EspnGameContext[]> {
  const contexts: EspnGameContext[] = [];
  for (const gameId of gameIds) {
    const result = await espnClient.getSummary(gameId);
    if (!result.ok) {
      console.error(`[harness] skipping ${gameId}: summary failed (${result.kind}) ${result.reason}`);
      continue;
    }
    const context = resolveGameContext(result.data, gameId);
    if (!context) {
      console.error(`[harness] skipping ${gameId}: could not identify both teams`);
      continue;
    }
    contexts.push(context);
  }
  return contexts;
}

/**
 * Gives the user an offensive stake in exactly ONE team per game (the home side).
 *
 * One team, not both, is deliberate: with a stake in both sides the game stays flagged through every
 * possession change and `diffFlagStates`' +/-3 priority threshold swallows the delta, so no event is
 * emitted — which would quietly produce a run with no notifications at all. One team per game makes
 * each possession change a clean `flag_added` / `flag_removed` pair, which is exactly the
 * possession-change notification under test.
 *
 * One player per team, not several, so `notificationTitle` renders "Colts RB1 active" (naming the
 * game on the phone's lock screen) instead of collapsing to "2 of your players active".
 */
function buildLineup(userId: string, contexts: EspnGameContext[]): UserLineupCache {
  const teamPositions = new Map<string, Set<'offense' | 'defense'>>();
  const playerToTeam = new Map<string, string>();
  const starPlayerIds = new Set<string>();

  contexts.forEach((context, index) => {
    const team = stakeTeamFor(context);
    teamPositions.set(team, new Set<'offense' | 'defense'>(['offense']));
    const playerId = `${team}-RB1`;
    playerToTeam.set(playerId, team);
    // One star overall, to exercise the `star_player_active` reason and a higher priority score
    // without making every game look identical.
    if (index === 0) starPlayerIds.add(playerId);
  });

  return { userId, week: 0, teamPositions, playerToTeam, starPlayerIds };
}

function seedPlayers(catalog: InMemoryPlayerCatalog, contexts: EspnGameContext[]): void {
  for (const context of contexts) {
    const team = stakeTeamFor(context);
    catalog.setPlayer({
      playerId: `${team}-RB1`,
      firstName: teamInfo(team).nickname,
      lastName: 'RB1',
      position: 'RB',
    });
  }
}

function seedGameCatalog(catalog: InMemoryGameCatalog, contexts: EspnGameContext[]): void {
  for (const context of contexts) {
    const home = teamInfo(context.homeTeamId);
    const away = teamInfo(context.awayTeamId);
    catalog.setGame(context.gameId, {
      homeTeamAbbreviation: context.homeTeamId,
      awayTeamAbbreviation: context.awayTeamId,
      homeTeamName: home.nickname,
      awayTeamName: away.nickname,
      homeTeamPrimaryColor: home.primaryColor,
      homeTeamSecondaryColor: home.secondaryColor,
      awayTeamPrimaryColor: away.primaryColor,
      awayTeamSecondaryColor: away.secondaryColor,
    });
  }
}

/**
 * Seeds `sunday_ticket` for every game and subscribes both users to it, so `deliverFlagEvent` resolves
 * a real `action.deep_link_url` and a notification tap opens YouTube TV.
 *
 * `sunday_ticket` also carries the largest `BROADCAST_LAG_SECONDS` entry, but that value cannot affect
 * this run: `scheduledFireAt` comes from `ResumptionGatedDispatcher`, never from `lagSecondsFor`. Here
 * the resolved source only selects which broadcast the CTA points at.
 */
function seedBroadcasts(catalog: InMemoryBroadcastCatalog, contexts: EspnGameContext[]): void {
  for (const context of contexts) {
    const videoId = GAME_VIDEO_IDS[context.gameId];
    const deepLinkUrl = videoId ? `https://tv.youtube.com/watch/${videoId}` : YOUTUBE_TV_DEEP_LINK;
    catalog.setGameBroadcasts(context.gameId, [
      {
        service: 'sunday_ticket',
        deepLinkUrl,
        requiresSubscription: true,
      },
    ]);
  }
  catalog.setUserSubscribedServices(WATCHED_USER_ID, ['sunday_ticket']);
  catalog.setUserSubscribedServices(DATA_ONLY_USER_ID, ['sunday_ticket']);
}

function makeUser(id: string, expoPushToken: string | null): DispatchUser {
  return {
    id,
    subscriptionTier: 'pro',
    preferences: {
      notificationMode: 'all',
      // Quiet hours off explicitly: a late-afternoon slate would not trip the 22->8 default, but
      // leaving it on would make an evening run silently drop everything.
      quietHours: { enabled: false, startHour: 22, endHour: 8, timezone: 'America/New_York' },
      autoSwitch: false,
      watchedLeagueIds: [],
    },
    expoPushToken,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --------------------------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------------------------

async function runList(): Promise<void> {
  const games = await fetchScoreboard();
  console.log(`\nESPN scoreboard — ${games.length} game(s) today\n`);
  for (const game of games) {
    console.log(`  ${game.eventId}  ${game.away.padEnd(4)} @ ${game.home.padEnd(4)}  ${game.state}`);
  }
  console.log(
    '\nPick the games you can actually see on screen for --watch; pass --data auto for the rest.\n',
  );
}

async function runHarness(config: HarnessConfig): Promise<void> {
  if (config.watchedGameIds.length === 0) {
    throw new Error('--watch requires at least one ESPN event id (see --list)');
  }
  if (config.pushToken === null) {
    console.warn(
      '[harness] no push token — PUSH_DRIVER=none. The push path still runs; payloads are logged, not sent.',
    );
  }

  let dataOnlyGameIds = config.dataOnlyGameIds;
  if (config.autoFillDataGames) {
    const games = await fetchScoreboard();
    dataOnlyGameIds = games
      .filter((g) => !config.watchedGameIds.includes(g.eventId) && g.state !== 'post')
      .map((g) => g.eventId);
  }
  dataOnlyGameIds = dataOnlyGameIds.filter((id) => !config.watchedGameIds.includes(id));

  const [watchedContexts, dataOnlyContexts] = await Promise.all([
    resolveContexts(config.watchedGameIds),
    resolveContexts(dataOnlyGameIds),
  ]);

  if (watchedContexts.length === 0) {
    throw new Error('none of the --watch ids resolved to a game with identifiable teams');
  }

  await mkdir(LOG_DIR, { recursive: true });
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const playsLog = new JsonlLog(path.join(LOG_DIR, `plays-${runId}.jsonl`));
  const eventsLog = new JsonlLog(path.join(LOG_DIR, `events-${runId}.jsonl`));

  // ---- providers ----
  const gameStateStore = new InMemoryGameStateStore();
  const queue = new InMemoryFlagEventQueue();
  const broadcastCatalog = new InMemoryBroadcastCatalog();
  const gameCatalog = new InMemoryGameCatalog();
  const playerCatalog = new InMemoryPlayerCatalog();
  const userDirectory = new InMemoryUserDirectory();
  const realtimeBus = new InMemoryRealtimeBus();

  const rateLimitStore = new MeasuringRateLimitStore((userId, recentCount) => {
    eventsLog.write({ kind: 'rate_limit_would_drop', userId, recentCount });
    console.log(`[harness] RATE LIMIT (measured only) user=${userId} recent=${recentCount}`);
  });

  const persistence = new LoggingFlagEventPersistence((input) => {
    eventsLog.write({
      kind: 'delivered',
      eventId: input.id,
      userId: input.userId,
      gameId: input.gameId,
      eventType: input.eventType,
      priorityScore: input.priorityScore,
      reasons: input.reasons.map((r) => r.type),
      firedAt: input.firedAt,
      deliveredAt: input.deliveredAt,
    });
  });

  const pushNotifier = new LoggingPushNotifier(
    createPushNotifier(
      config.pushToken === null ? { pushDriver: 'none' } : { pushDriver: 'expo' },
    ),
    (eventId, payload, result) => {
      eventsLog.write({
        kind: 'push',
        eventId,
        gameId: (payload.data as { game_id?: string } | null)?.game_id ?? null,
        title: payload.title,
        body: payload.body,
        deepLinkUrl: (payload.data as { action?: { deep_link_url?: string | null } } | null)?.action
          ?.deep_link_url ?? null,
        success: result.success,
        error: result.error ?? null,
      });
      const status = result.success ? 'PUSH OK' : `PUSH FAIL (${result.error ?? 'unknown'})`;
      console.log(`[harness] ${status} :: ${payload.title} — ${payload.body}`);
    },
  );

  const allContexts = [...watchedContexts, ...dataOnlyContexts];
  seedGameCatalog(gameCatalog, allContexts);
  seedPlayers(playerCatalog, allContexts);
  seedBroadcasts(broadcastCatalog, allContexts);

  // Shim 1: stakes keyed by ESPN abbreviation. Watched games belong to the token-bearing user so
  // only they generate pushes (Shim/see header "watched vs data-only").
  for (const context of watchedContexts) {
    gameStateStore.addStake(stakeTeamFor(context), WATCHED_USER_ID);
  }
  for (const context of dataOnlyContexts) {
    gameStateStore.addStake(stakeTeamFor(context), DATA_ONLY_USER_ID);
  }

  userDirectory.setUser(makeUser(WATCHED_USER_ID, config.pushToken ?? DRY_RUN_PUSH_TOKEN));
  // Data-only games get no token, which is what suppresses their pushes — see the header.
  userDirectory.setUser(makeUser(DATA_ONLY_USER_ID, null));

  const lineupCache = new FixedLineupCache(
    new Map([
      [WATCHED_USER_ID, buildLineup(WATCHED_USER_ID, watchedContexts)],
      [DATA_ONLY_USER_ID, buildLineup(DATA_ONLY_USER_ID, dataOnlyContexts)],
    ]),
  );

  const delivery: DeliveryDeps = {
    gameStateStore,
    gameCatalog,
    playerCatalog,
    broadcastCatalog,
    userDirectory,
    persistence,
    realtimeBus,
    rateLimitStore,
    pushNotifier,
  };

  const gate = new ResumptionGatedDispatcher({
    queue,
    onGated: (record: GatedEventRecord) => {
      const { event, decision, holdMs, resolution } = record;
      eventsLog.write({
        kind: 'gated',
        eventId: event.id,
        userId: event.userId,
        gameId: event.gameId,
        eventType: event.type,
        decision,
        holdMs,
        flagged: event.newState.flagged,
        priorityScore: event.newState.priorityScore,
        reasons: event.newState.reasons.map((r) => r.type),
        computedAt: event.newState.computedAt,
        scheduledFireAt: event.scheduledFireAt,
        resumptionOutcome: resolution?.outcome ?? null,
        resumptionElapsedMs: resolution?.elapsedMs ?? null,
        resumptionResolvedBy: resolution?.resolvedBy ?? null,
        precedingPlayId: resolution?.precedingPlay.play.playId ?? null,
        triggerPlayId: resolution?.outcome === 'REAL_ACTION' ? resolution.triggerPlay.play.playId : null,
      });
      console.log(
        `[harness] ${event.gameId} EVENT ${event.type} ${decision} hold=${holdMs}ms prio=${event.newState.priorityScore}`,
      );
    },
  });

  const engineDeps: OnPlayEventDeps = { lineupCache, gameState: gameStateStore, dispatcher: gate };

  const tickDeps: DispatcherTickDeps = {
    queue,
    gameStateStore,
    userDirectory,
    rateLimitStore,
    delivery,
  };

  // Shim 2: liveness asserted on a timer, immune to the app's socket lifecycle.
  const markActive = async (): Promise<void> => {
    await gameStateStore.markUserActive(WATCHED_USER_ID, ACTIVE_USER_TTL_MS);
    await gameStateStore.markUserActive(DATA_ONLY_USER_ID, ACTIVE_USER_TTL_MS);
  };
  await markActive();
  const livenessTimer = setInterval(() => void markActive(), LIVENESS_REFRESH_MS);

  // ---- per-game play handling ----
  let weekLogged = false;

  const makeHandler = (gameId: string): ((play: PlayEvent) => Promise<void>) => {
    const tracker = new IncrementalResumptionTracker(gameId, {
      onWindowOpened: (gid, window) => {
        gate.noteWindowOpened(gid);
        eventsLog.write({
          kind: 'resumption_window_opened',
          gameId: gid,
          precedingPlayId: window.precedingPlay.play.playId,
          precedingPlayType: window.precedingPlay.play.playType,
          precedingPossession: window.precedingPlay.play.possessionTeamId,
          revealingPlayId: window.revealingPlay.play.playId,
          revealingPlayType: window.revealingPlay.play.playType,
          revealingCategory: classifyPlayType(window.revealingPlay.play.playType),
        });
      },
      onResolved: (gid, resolution: ResumptionResolution) => {
        gate.noteResolution(gid, resolution);
        eventsLog.write({
          kind: 'resumption_resolved',
          gameId: gid,
          outcome: resolution.outcome,
          elapsedMs: resolution.elapsedMs,
          resolvedBy: resolution.resolvedBy,
          precedingPlayId: resolution.precedingPlay.play.playId,
          triggerPlayId:
            resolution.outcome === 'REAL_ACTION' ? resolution.triggerPlay.play.playId : null,
          triggerPlayType:
            resolution.outcome === 'REAL_ACTION' ? resolution.triggerPlay.play.playType : null,
          abortPlayType: resolution.outcome === 'ABORTED' ? resolution.abortPlay.play.playType : null,
        });
        console.log(
          `[harness] ${gid} RESUMPTION ${resolution.outcome} after ${(resolution.elapsedMs / 1000).toFixed(1)}s (${resolution.resolvedBy})`,
        );
      },
    });

    return async (play: PlayEvent): Promise<void> => {
      const observedAt = Date.now();

      if (!weekLogged) {
        weekLogged = true;
        eventsLog.write({ kind: 'observed_week', week: play.week });
        console.log(`[harness] ESPN reports week=${play.week} (lineup cache ignores week by design)`);
      }

      playsLog.write({
        kind: 'play',
        gameId: play.gameId,
        playId: play.playId,
        playType: play.playType,
        category: classifyPlayType(play.playType),
        possession: play.possessionTeamId,
        home: play.homeTeamId,
        away: play.awayTeamId,
        quarter: play.quarter,
        secondsRemainingInQuarter: play.secondsRemainingInQuarter,
        down: play.down,
        distance: play.distance,
        yardsToOpponentEndzone: play.yardsToOpponentEndzone,
        scoreHome: play.scoreHome,
        scoreAway: play.scoreAway,
        isFinalPlay: play.isFinalPlay,
        week: play.week,
      });

      console.log(
        `[${stamp(observedAt)}] ${play.gameId} ${clockLabel(play)} | ` +
          `${play.down ?? '-'}&${play.distance ?? '-'} @${play.yardsToOpponentEndzone ?? '-'} | ` +
          `poss: ${play.possessionTeamId ?? '—'} | ${play.playType} | ` +
          `${play.awayTeamId} ${play.scoreAway}-${play.scoreHome} ${play.homeTeamId}`,
      );

      // Resumption is evaluated BEFORE the play's flag consequences, so the gate already knows
      // whether play has resumed by the time `onPlayEvent` dispatches anything for this play.
      gate.beginPlay(gameId);
      tracker.observe(play, observedAt);

      await onPlayEvent(engineDeps, play);

      if (config.replayDelayMs > 0) await sleep(config.replayDelayMs);
    };
  };

  // ---- run ----
  const controller = new AbortController();
  const loop = startDispatcherLoop(tickDeps, {
    signal: controller.signal,
    onTick: (result) => {
      if (result.processed === 0) return;
      eventsLog.write({ kind: 'tick', ...result });
      if (result.droppedStale > 0 || result.droppedMissingUser > 0 || result.droppedRateLimited > 0) {
        console.log(`[harness] tick drops ${JSON.stringify(result)}`);
      }
    },
  });

  const pollStats = new Map<string, PollStats>();
  const sources = allContexts.map((context) => {
    const stats = new PollStats();
    pollStats.set(context.gameId, stats);
    return new EspnPlaySource({
      eventId: context.gameId,
      pollIntervalMs: config.pollIntervalMs,
      client: new InstrumentedEspnClient((ok, latencyMs, kind, reason) => {
        stats.record(ok, latencyMs);
        if (ok) return;
        eventsLog.write({
          kind: 'espn_poll_failure',
          gameId: context.gameId,
          failureKind: kind,
          reason,
          latencyMs,
        });
        console.error(`[harness] ESPN poll FAILED ${context.gameId} (${kind ?? '?'}) ${reason ?? ''}`);
      }),
    });
  });

  const healthTimer = setInterval(() => {
    for (const [gameId, stats] of pollStats) {
      const summary = stats.drain();
      if (summary) eventsLog.write({ kind: 'espn_health', gameId, ...summary });
    }
  }, ESPN_HEALTH_INTERVAL_MS);

  // `EspnPlaySource` only notices `disconnect()` after its current sleep elapses, so a clean stop can
  // take up to one poll interval. Logs are already on disk (synchronous writes), so a second signal
  // can safely hard-exit rather than making the operator wait.
  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) {
      console.log('[harness] forced exit');
      process.exit(130);
    }
    shuttingDown = true;
    console.log(`\n[harness] stopping (up to ${config.pollIntervalMs}ms) — Ctrl-C again to force`);
    eventsLog.write({ kind: 'shutdown' });
    clearInterval(livenessTimer);
    clearInterval(healthTimer);
    controller.abort();
    for (const source of sources) void source.disconnect();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(
    `\n[harness] watching ${watchedContexts.length} game(s) with push, ` +
      `${dataOnlyContexts.length} data-only, poll ${config.pollIntervalMs}ms`,
  );
  for (const context of watchedContexts) {
    console.log(
      `  WATCH  ${context.gameId}  ${context.awayTeamId} @ ${context.homeTeamId}  ` +
        `(stake: ${stakeTeamFor(context)} offense)`,
    );
  }
  for (const context of dataOnlyContexts) {
    console.log(`  data   ${context.gameId}  ${context.awayTeamId} @ ${context.homeTeamId}`);
  }
  console.log(`\n[harness] logs -> ${LOG_DIR}\n`);

  // `subscribe()` runs until its game goes final, so these MUST be concurrent — awaiting them in
  // sequence would poll the first game forever and never start the rest.
  await Promise.all(
    allContexts.map((context, index) => {
      const source = sources[index];
      if (!source) return Promise.resolve();
      return source.subscribe(makeHandler(context.gameId)).catch((error: unknown) => {
        console.error(`[harness] ${context.gameId} source threw: ${String(error)}`);
      });
    }),
  );

  // Only worth draining when games ended naturally; on an operator stop the queue is deliberately
  // abandoned rather than making them wait another 10s for events they are no longer watching for.
  if (!shuttingDown) {
    console.log(`[harness] all games final — draining queue for ${DRAIN_MS / 1000}s`);
    await sleep(DRAIN_MS);
    clearInterval(livenessTimer);
    clearInterval(healthTimer);
    controller.abort();
  }

  await loop;
  console.log('[harness] done.');
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  if (config.mode === 'list') {
    await runList();
    return;
  }
  await runHarness(config);
}

main().catch((error: unknown) => {
  console.error('[harness] fatal:', error);
  process.exitCode = 1;
});
