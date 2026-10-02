/**
 * THROWAWAY harness — not part of the Pivot app, not production code.
 *
 * Replays one game recorded by `espn-live-recorder.ts` through the real P0 runner
 * (`startLiveRunner`, the same wiring as `services/api/src/runner.ts`) against the LOCAL stack, so
 * the simulator's Home receives `game_state` and flag events over the WebSocket exactly as it would
 * live. The only substitution is ESPN itself: global `fetch` for `site.api.espn.com` serves the
 * recorded payload at the replay's virtual time, and the production `espnClient` still builds the
 * URLs and validates every body. Everything else (Supabase, Sleeper) passes through. The served
 * scoreboard carries the game's status from the summary at the same instant (`scoreboardForGame`).
 *
 *   pnpm tsx experiments/replay-live.ts --recording <dir> [--game <espnId>] [--speed 20] [--from <ISO>]
 *
 * Side effects, all undone on Ctrl+C (see REPLAY-LIVE.md):
 * - The game's `games` row is moved into the current NFL week, kickoff rebased to the replay clock,
 *   status `scheduled`. Home is week-scoped, so a past week's game would never render otherwise.
 * - The runner writes `game_state` / `user_flag_state` / seen plays / queue / rate-limit entries
 *   to Redis and `flag_events` rows to Postgres for that game.
 * Push is forced to `none`.
 */

import { readdir, readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { config as loadEnv } from 'dotenv';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createPushNotifier,
  parseQueuedFlagEvent,
  resumptionOpenKey,
  type RateLimitStore,
  type RealtimeBus,
} from '@pivot/dispatcher';
import { espnClient } from '@pivot/ingestion';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, '../services/api');

const ESPN_HOST = 'site.api.espn.com';
const ESPN_SEED_PREFIX = 'seed:espn:';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
// Key names private to services/api/src/runner/tcpRedis.ts; keep in sync.
const QUEUE_KEY = 'flag_event_queue';
const gameStateKey = (gameId: string): string => `game_state:${gameId}`;
const userFlagStatePattern = (gameId: string): string => `user_flag_state:*:${gameId}`;
const notificationsKey = (userId: string): string => `user_notifications:${userId}`;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Args {
  recording: string;
  game: string | undefined;
  speed: number;
  from: number | undefined;
}

interface Frame {
  at: number;
  file: string;
}

interface GameRow {
  id: string;
  week: number;
  season_type: string;
  scheduled_start: string;
  status: string;
}

interface RedisClient {
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zrem(key: string, ...members: string[]): Promise<number>;
  quit(): Promise<unknown>;
}

interface GameDirectoryLike {
  setStatus(gameId: string, status: 'in_progress' | 'final'): Promise<void>;
}

interface RunnerHandle {
  stop(): void;
  done: Promise<void>;
}

interface GameSummaryLike {
  home_team: string;
  away_team: string;
  score: { home: number; away: number };
  quarter: number;
  time_remaining_sec: number;
}

const USAGE =
  'usage: pnpm tsx experiments/replay-live.ts --recording <dir> [--game <espnId>] [--speed 20] [--from <ISO>]';

function fail(message: string): never {
  console.error(`[replay] ${message}`);
  process.exit(1);
}

function parseArgs(argv: readonly string[]): Args {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!['--recording', '--game', '--speed', '--from'].includes(flag) || value === undefined) {
      fail(USAGE);
    }
    values.set(flag, value);
  }
  const recording = values.get('--recording');
  if (recording === undefined) fail(USAGE);
  const speed = Number(values.get('--speed') ?? '20');
  if (!Number.isFinite(speed) || speed <= 0) fail('--speed must be a positive number');
  const fromRaw = values.get('--from');
  const from = fromRaw === undefined ? undefined : Date.parse(fromRaw);
  if (from !== undefined && Number.isNaN(from)) fail(`--from is not an ISO timestamp: ${fromRaw}`);
  return { recording: path.resolve(recording), game: values.get('--game'), speed, from };
}

/** Null when both URLs point at this machine. The replay never touches a remote stack. */
function localStackRefusal(env: NodeJS.ProcessEnv): string | null {
  for (const name of ['REDIS_URL', 'SUPABASE_URL'] as const) {
    const raw = env[name];
    if (raw === undefined || raw.length === 0) return `${name} is not set`;
    let host: string;
    try {
      host = new URL(raw).hostname.toLowerCase();
    } catch {
      return `${name} is not a URL`;
    }
    if (!LOCAL_HOSTS.has(host)) {
      return `refusing to run: ${name} host is ${host}, not localhost/127.0.0.1/::1`;
    }
  }
  return null;
}

async function loadFrames(dir: string): Promise<Frame[]> {
  const names = (await readdir(dir)).filter((name) => name.endsWith('.json.gz'));
  return names
    .map((name) => ({
      at: Date.parse(name.slice(0, -'.json.gz'.length)),
      file: path.join(dir, name),
    }))
    .filter((frame) => !Number.isNaN(frame.at))
    .sort((a, b) => a.at - b.at);
}

/** The latest frame recorded at or before `t`; the first frame before the recording starts. */
function frameAt(frames: readonly Frame[], t: number): Frame {
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (frames[mid].at <= t) low = mid;
    else high = mid - 1;
  }
  return frames[low];
}

async function resolveGame(recording: string, game: string | undefined): Promise<string> {
  const entries = await readdir(recording, { withFileTypes: true });
  const games = entries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => entry.name);
  if (game !== undefined) {
    if (!games.includes(game)) fail(`no ${game}/ under ${recording} (found: ${games.join(', ')})`);
    return game;
  }
  if (games.length !== 1) {
    fail(`${recording} has ${games.length} games (${games.join(', ')}); pass --game <espnId>`);
  }
  return games[0];
}

function clockLabel(summary: GameSummaryLike | undefined): string {
  if (summary === undefined || summary.quarter === 0) return 'pre    ';
  const sec = Math.max(0, summary.time_remaining_sec);
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  const quarter = summary.quarter > 4 ? 'OT' : `Q${summary.quarter}`;
  return `${quarter} ${mm}:${ss}`;
}

function scoreLabel(summary: GameSummaryLike): string {
  return `${summary.away_team} ${summary.score.away}-${summary.score.home} ${summary.home_team}`;
}

function printEvent(clock: string, type: string, detail: string): void {
  console.log(`${new Date().toISOString()}  ${clock}  ${type.padEnd(18)} ${detail}`);
}

/** Logs one line per realtime envelope the runner publishes, then publishes it unchanged. */
function loggingBus(bus: RealtimeBus): RealtimeBus {
  return {
    async publish(channel: string, message: unknown): Promise<void> {
      const envelope = message as { type?: string; payload?: Record<string, unknown> };
      if (envelope.type === 'game_state' && envelope.payload !== undefined) {
        const summary = envelope.payload as unknown as GameSummaryLike & { status: string };
        const type = summary.status === 'final' ? 'final' : 'game_state';
        printEvent(clockLabel(summary), type, scoreLabel(summary));
      } else if (envelope.type === 'flag_event' && envelope.payload !== undefined) {
        const payload = envelope.payload as {
          event_type: string;
          user_id: string;
          game_summary: GameSummaryLike;
          flagged_players: { first_name: string; last_name: string; position: string }[];
        };
        const players = payload.flagged_players
          .map((p) => `${p.first_name} ${p.last_name} (${p.position})`)
          .join(', ');
        printEvent(
          clockLabel(payload.game_summary),
          payload.event_type,
          `user ${payload.user_id.slice(0, 8)} ${players}`,
        );
      }
      await bus.publish(channel, message);
    },
  };
}

interface ScoreboardEvent {
  id: string;
  status?: Record<string, unknown>;
  competitions?: { status?: Record<string, unknown> }[];
}

/**
 * The recorded scoreboard narrowed to one game, with that event's `status.type` taken from the
 * summary at the same virtual time. The recorder polled the scoreboard about once a minute and can
 * stop before the final (2026-09-28 ends at 0:39 Q4), while summaries run every ~10s to
 * `STATUS_FINAL`. Discovery reads the scoreboard status, so it has to agree with the summary.
 */
export function scoreboardForGame(boardJson: string, summaryJson: string, espnId: string): string {
  const board = JSON.parse(boardJson) as { events?: ScoreboardEvent[] };
  const summary = JSON.parse(summaryJson) as {
    header?: { competitions?: { status?: { type?: unknown } }[] };
  };
  const type = summary.header?.competitions?.[0]?.status?.type;
  const events = (board.events ?? [])
    .filter((event) => event.id === espnId)
    .map((event) =>
      type === undefined
        ? event
        : {
            ...event,
            status: { ...event.status, type },
            competitions: event.competitions?.map((c) => ({
              ...c,
              status: { ...c.status, type },
            })),
          },
    );
  return JSON.stringify({ ...board, events });
}

const SEASON_TYPES: Record<number, string> = { 1: 'pre', 2: 'regular', 3: 'post' };

/** Kickoff and week for the game as ESPN reported them in the latest scoreboard frame listing it. */
async function recordedEvent(
  boards: readonly Frame[],
  espnId: string,
): Promise<{ date: string; week: number; seasonType: string }> {
  for (let i = boards.length - 1; i >= 0; i -= 1) {
    const board = JSON.parse(gunzipSync(await readFile(boards[i].file)).toString('utf8')) as {
      week?: { number?: number };
      season?: { type?: number };
      events?: { id: string; date: string }[];
    };
    const event = board.events?.find((e) => e.id === espnId);
    if (event !== undefined) {
      return {
        date: event.date,
        week: board.week?.number ?? 0,
        seasonType: SEASON_TYPES[board.season?.type ?? 0] ?? 'regular',
      };
    }
  }
  fail(`ESPN ${espnId} is not on any recorded scoreboard frame`);
}

function json(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const espnId = await resolveGame(args.recording, args.game);
  const summaries = await loadFrames(path.join(args.recording, espnId));
  const boards = await loadFrames(path.join(args.recording, 'scoreboard')).catch(() => []);
  if (summaries.length === 0) fail(`no summary frames in ${path.join(args.recording, espnId)}`);
  if (boards.length === 0)
    fail(`no scoreboard frames in ${path.join(args.recording, 'scoreboard')}`);
  const from = args.from ?? summaries[0].at;
  const lastFrameAt = summaries[summaries.length - 1].at;

  loadEnv({ path: path.join(API_DIR, '.env'), quiet: true });
  const refusal = localStackRefusal(process.env);
  if (refusal !== null) fail(refusal);

  // Non-literal specifiers: these live outside experiments/'s tsconfig rootDir (same pattern as
  // dev-server-with-live-ingest.ts), so they load as untyped dynamic imports.
  const mod = (file: string): string => path.join(API_DIR, 'src', file);
  const { env } = (await import(mod('env.js'))) as { env: Record<string, unknown> };
  const { createSupabaseServiceClient } = (await import(mod('lib/supabase.js'))) as {
    createSupabaseServiceClient: (env: unknown) => SupabaseClient;
  };
  const { getCurrentNflState } = (await import(mod('lib/nfl-state.js'))) as {
    getCurrentNflState: (cache: unknown) => Promise<{ week: number; seasonType: string }>;
  };
  const { TcpLineupCache } = (await import(mod('cache/tcp.js'))) as {
    TcpLineupCache: new (redis: RedisClient) => unknown;
  };
  const { LEADER_KEY } = (await import(mod('runner/leaderLock.js'))) as { LEADER_KEY: string };
  const { espnSeenPlaysKey } = (await import(mod('runner/seenPlays.js'))) as {
    espnSeenPlaysKey: (espnEventId: string) => string;
  };
  const { startLiveRunner } = (await import(mod('runner/liveRunner.js'))) as {
    startLiveRunner: (deps: Record<string, unknown>) => RunnerHandle;
  };
  const { SupabaseFlagEventPersistence } = (await import(
    mod('runner/supabaseFlagEventPersistence.js')
  )) as { SupabaseFlagEventPersistence: new (client: SupabaseClient) => unknown };
  const catalogs = (await import(mod('runner/supabaseCatalogs.js'))) as {
    SupabaseBroadcastCatalog: new (client: SupabaseClient) => unknown;
    SupabaseGameAiringsStore: new (client: SupabaseClient) => unknown;
    SupabaseGameCatalog: new (client: SupabaseClient) => unknown;
    SupabaseGameDirectory: new (client: SupabaseClient) => GameDirectoryLike;
    SupabasePlayerCatalog: new (client: SupabaseClient) => unknown;
    SupabaseUserDirectory: new (client: SupabaseClient) => unknown;
  };
  const tcp = (await import(mod('runner/tcpRedis.js'))) as {
    createTcpRedis: (url: string, label?: string) => RedisClient;
    tcpFlagEventQueue: (redis: RedisClient) => unknown;
    tcpGameState: (redis: RedisClient) => unknown;
    tcpLeaderLock: (redis: RedisClient) => unknown;
    tcpRateLimit: (redis: RedisClient) => RateLimitStore;
    tcpRealtimeBus: (redis: RedisClient) => RealtimeBus;
    tcpResumptionOpenStore: (redis: RedisClient) => unknown;
    tcpSeenPlays: (redis: RedisClient) => unknown;
  };

  const redis = tcp.createTcpRedis(String(process.env['REDIS_URL']), 'replay');
  const supabase = createSupabaseServiceClient(env);
  const lineupCache = new TcpLineupCache(redis);
  const owner = `replay-live:${hostname()}:${process.pid}`;

  const holder = await redis.get(LEADER_KEY);
  if (holder !== null) {
    await redis.quit();
    fail(`${LEADER_KEY} is held by ${holder}. Stop the other runner first (it shares these keys).`);
  }

  const { data: found, error: findError } = await supabase
    .from('games')
    .select('id, week, season_type, scheduled_start, status')
    .eq('sportradar_id', `${ESPN_SEED_PREFIX}${espnId}`)
    .maybeSingle();
  if (findError !== null || found === null) {
    await redis.quit();
    fail(`no local games row for ESPN ${espnId}${findError ? `: ${findError.message}` : ''}`);
  }
  const original = found as GameRow;
  const gameId = original.id;
  const recorded = await recordedEvent(boards, espnId);
  const recordedKickoff = Date.parse(recorded.date);
  if (Date.parse(original.scheduled_start) !== recordedKickoff) {
    await redis.quit();
    fail(
      `games ${gameId} kicks off ${original.scheduled_start} but the recording says ${recorded.date}; ` +
        'a previous replay probably did not exit cleanly. Restore it first: ' +
        `update games set week=${recorded.week}, season_type='${recorded.seasonType}', ` +
        `scheduled_start='${recorded.date}', status='final' where id='${gameId}';`,
    );
  }
  const nflState = await getCurrentNflState(lineupCache);

  const notified = new Map<string, Set<string>>();
  async function clearReplayState(): Promise<void> {
    const keys = [
      gameStateKey(gameId),
      espnSeenPlaysKey(espnId),
      resumptionOpenKey(gameId),
      ...(await redis.keys(userFlagStatePattern(gameId))),
    ];
    let removed = await redis.del(...keys);
    const queued = (await redis.zrange(QUEUE_KEY, 0, -1)).filter((raw) => {
      try {
        return parseQueuedFlagEvent(raw).event.gameId === gameId;
      } catch {
        return false;
      }
    });
    if (queued.length > 0) removed += await redis.zrem(QUEUE_KEY, ...queued);
    for (const [userId, eventIds] of notified) {
      if (eventIds.size > 0) removed += await redis.zrem(notificationsKey(userId), ...eventIds);
    }
    // Replay rows fire at wall time, weeks after the recorded kickoff; real rows fire on game day.
    const { count, error } = await supabase
      .from('flag_events')
      .delete({ count: 'exact' })
      .eq('game_id', gameId)
      .gt('fired_at', new Date(recordedKickoff + DAY_MS).toISOString());
    if (error !== null) console.error(`[replay] flag_events cleanup failed: ${error.message}`);
    console.log(`[replay] cleared ${removed} Redis entries, ${count ?? 0} flag_events rows`);
  }

  async function restoreGameRow(): Promise<void> {
    const { error } = await supabase
      .from('games')
      .update({
        week: original.week,
        season_type: original.season_type,
        scheduled_start: original.scheduled_start,
        status: original.status,
      })
      .eq('id', gameId);
    if (error !== null) {
      console.error(`[replay] restore failed for games ${gameId}: ${error.message}`);
      console.error(
        `[replay] restore by hand: week=${original.week} season_type=${original.season_type} scheduled_start=${original.scheduled_start} status=${original.status}`,
      );
      return;
    }
    console.log(
      `[replay] restored games ${gameId} to week ${original.week} ${original.status} ${original.scheduled_start}`,
    );
  }

  await clearReplayState();

  const startWall = Date.now();
  const virtualNow = (): number => from + (Date.now() - startWall) * args.speed;
  const toWall = (recordedAt: number): number => startWall + (recordedAt - from) / args.speed;

  const { error: rebaseError } = await supabase
    .from('games')
    .update({
      week: nflState.week,
      season_type: nflState.seasonType,
      scheduled_start: new Date(toWall(recordedKickoff)).toISOString(),
      status: 'scheduled',
    })
    .eq('id', gameId);
  if (rebaseError !== null) {
    await redis.quit();
    fail(`could not move games ${gameId} into week ${nflState.week}: ${rebaseError.message}`);
  }

  let cachedFile = '';
  let cachedBody = '';
  async function read(frame: Frame): Promise<string> {
    if (frame.file !== cachedFile) {
      cachedBody = gunzipSync(await readFile(frame.file)).toString('utf8');
      cachedFile = frame.file;
    }
    return cachedBody;
  }
  let exhaustedLogged = false;
  async function summaryBody(): Promise<string> {
    const now = virtualNow();
    if (now > lastFrameAt && !exhaustedLogged) {
      exhaustedLogged = true;
      console.log(
        '[replay] recording exhausted; Home stays on the last frame. Ctrl+C to clean up.',
      );
    }
    return read(frameAt(summaries, now));
  }
  async function scoreboardBody(): Promise<string> {
    const now = virtualNow();
    const board = gunzipSync(await readFile(frameAt(boards, now).file)).toString('utf8');
    return scoreboardForGame(board, await read(frameAt(summaries, now)), espnId);
  }

  const passthrough = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== ESPN_HOST) return passthrough(input, init);
    if (url.pathname.endsWith('/summary') && url.searchParams.get('event') === espnId) {
      return json(await summaryBody());
    }
    if (url.pathname.endsWith('/scoreboard')) return json(await scoreboardBody());
    return new Response('not in recording', { status: 404 });
  };

  const realtime = loggingBus(tcp.tcpRealtimeBus(redis));
  const rateLimit = tcp.tcpRateLimit(redis);
  const recordNotification = rateLimit.recordNotification.bind(rateLimit);
  rateLimit.recordNotification = async (userId, eventId, deliveredAtMs) => {
    const ids = notified.get(userId) ?? new Set<string>();
    ids.add(eventId);
    notified.set(userId, ids);
    await recordNotification(userId, eventId, deliveredAtMs);
  };
  const games = new catalogs.SupabaseGameDirectory(supabase);
  const setStatus = games.setStatus.bind(games);
  games.setStatus = async (id, status) => {
    await setStatus(id, status);
    if (id === gameId && status === 'final') {
      printEvent('final  ', 'final', 'games.status=final (scoreboard discovery)');
    }
  };

  const kickoffInSec = Math.max(0, Math.round((toWall(recordedKickoff) - Date.now()) / 1000));
  console.log(
    `[replay] ESPN ${espnId} -> games ${gameId}, moved into week ${nflState.week} until exit`,
  );
  console.log(
    `[replay] ${summaries.length} summary frames ${new Date(summaries[0].at).toISOString()} .. ${new Date(lastFrameAt).toISOString()}, ${boards.length} scoreboard frames`,
  );
  console.log(
    `[replay] from ${new Date(from).toISOString()} at ${args.speed}x; kickoff in ~${kickoffInSec}s; push driver none`,
  );
  console.log('wall time                 clock    event              detail');

  const handle = startLiveRunner({
    lock: tcp.tcpLeaderLock(redis),
    seen: tcp.tcpSeenPlays(redis),
    queue: tcp.tcpFlagEventQueue(redis),
    ceilingStore: tcp.tcpResumptionOpenStore(redis),
    gameState: tcp.tcpGameState(redis),
    rateLimit,
    realtime,
    lineupCache,
    stakeCache: { supabase, lineupCache },
    games,
    users: new catalogs.SupabaseUserDirectory(supabase),
    gameCatalog: new catalogs.SupabaseGameCatalog(supabase),
    players: new catalogs.SupabasePlayerCatalog(supabase),
    broadcasts: new catalogs.SupabaseBroadcastCatalog(supabase),
    airings: new catalogs.SupabaseGameAiringsStore(supabase),
    persistence: new SupabaseFlagEventPersistence(supabase),
    pushNotifier: createPushNotifier({ pushDriver: 'none' }),
    scoreboard: espnClient,
    owner,
  });

  let stopping = false;
  const shutdown = (): void => {
    if (stopping) {
      console.error('[replay] second signal: exiting without cleanup');
      process.exit(130);
    }
    stopping = true;
    console.log('[replay] stopping');
    handle.stop();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await handle.done;
  } finally {
    globalThis.fetch = passthrough;
    await clearReplayState();
    await restoreGameRow();
    const leader = await redis.get(LEADER_KEY);
    if (leader?.startsWith(`${owner}:`)) await redis.del(LEADER_KEY);
    await redis.quit();
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
