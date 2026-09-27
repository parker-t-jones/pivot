/**
 * Read-only diagnosis: why live LAC @ BUF produced no flag_events for the signed-in user.
 *
 * Uses the runner's `createPlaySession` against the local database and Docker Redis.
 * Redis and Postgres are read only. Game-state writes stay in memory. Flag persistence
 * is `InMemoryFlagEventPersistence`. Push driver is `none`.
 *
 *   pnpm exec tsx experiments/diagnose-live-flags.ts
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import {
  InMemoryBroadcastCatalog,
  InMemoryFlagEventPersistence,
  InMemoryFlagEventQueue,
  InMemoryGameCatalog,
  InMemoryGameStateStore,
  InMemoryPlayerCatalog,
  InMemoryRateLimitStore,
  InMemoryRealtimeBus,
  createPushNotifier,
  InMemoryResumptionOpenStore,
  InMemoryUserDirectory,
  ResumptionCeiling,
  ResumptionGatedDispatcher,
  runDispatcherTick,
  type DeliveryDeps,
  type FlagEventQueue,
  type QueuedFlagEvent,
} from '@pivot/dispatcher';
import { mapEspnPlay, resolveGameContext, summaryPlayIds, translatePlay } from '@pivot/ingestion';
import { parsePreferences, deserializeUserLineupCache, type FlagEvent } from '@pivot/shared';
import type { PlayEvent } from '@pivot/engine';

const EMAIL = 'parker.t.jones07@gmail.com';
const EVENT_ID = '401872953';
const SUMMARY_PATH = fileURLToPath(
  new URL('./logs/espn-summary-401872953-lac-buf.json', import.meta.url),
);

interface RedisReader {
  get(key: string): Promise<string | null>;
  smembers(key: string): Promise<string[]>;
  scard(key: string): Promise<number>;
  scan(cursor: string, ...args: Array<string | number>): Promise<[string, string[]]>;
  quit(): Promise<unknown>;
}

function asPlayer(value: unknown): {
  first_name: string;
  last_name: string;
  position: string;
  team_id: string;
} | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (typeof row !== 'object' || row === null) return null;
  const player = row as Record<string, unknown>;
  if (typeof player['team_id'] !== 'string') return null;
  return {
    first_name: typeof player['first_name'] === 'string' ? player['first_name'] : '',
    last_name: typeof player['last_name'] === 'string' ? player['last_name'] : '',
    position: typeof player['position'] === 'string' ? player['position'] : '',
    team_id: player['team_id'],
  };
}

function log(line: string): void {
  console.log(line);
}

function assertLocal(url: string, label: string): void {
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`${label} host is ${host}; refusing a non-local connection`);
  }
}

async function loadModule<T>(relativePath: string): Promise<T> {
  const href = new URL(relativePath, import.meta.url).href;
  return (await import(href)) as T;
}

function redisReader(url: string): RedisReader {
  const require = createRequire(new URL('../services/api/package.json', import.meta.url));
  const { Redis } = require('ioredis') as {
    Redis: new (
      url: string,
      options: { maxRetriesPerRequest: number },
    ) => RedisReader & {
      set(...args: unknown[]): Promise<unknown>;
      hset(...args: unknown[]): Promise<unknown>;
      sadd(...args: unknown[]): Promise<unknown>;
    };
  };
  const redis = new Redis(url, { maxRetriesPerRequest: 2 });
  const refuse = (command: string): never => {
    throw new Error(`refusing Redis write (${command})`);
  };
  redis.set = () => refuse('SET');
  redis.hset = () => refuse('HSET');
  redis.sadd = () => refuse('SADD');
  return redis;
}

async function scanKeys(redis: RedisReader, pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

async function main(): Promise<void> {
  loadEnv({ path: fileURLToPath(new URL('../services/api/.env', import.meta.url)), quiet: true });
  const supabaseUrl = process.env['SUPABASE_URL'];
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!supabaseUrl || !serviceKey) {
    throw new Error('services/api/.env is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  assertLocal(supabaseUrl, 'SUPABASE_URL');
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';
  assertLocal(redisUrl, 'REDIS_URL');

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const redis = redisReader(redisUrl);

  const { espnSummarySchema } = await loadModule<{
    espnSummarySchema: { parse(value: unknown): Parameters<typeof summaryPlayIds>[0] };
  }>('../services/ingestion/src/espn/espnTypes.ts');
  const summary = espnSummarySchema.parse(JSON.parse(readFileSync(SUMMARY_PATH, 'utf8')));
  const context = resolveGameContext(summary, EVENT_ID);
  if (!context) throw new Error('summary header did not identify both teams');

  log('checkpoint discovery  services/api/src/runner/supabaseCatalogs.ts:21');
  log(
    `  espn event=${EVENT_ID} week=${context.week} home=${context.homeTeamId} away=${context.awayTeamId} plays=${summaryPlayIds(summary).length}`,
  );
  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('id, home_team_id, away_team_id, week, status, sportradar_id, scheduled_start')
    .eq('sportradar_id', `seed:espn:${EVENT_ID}`)
    .maybeSingle();
  if (gameError) throw new Error(gameError.message);
  if (!game) {
    log('  FIRST_BREAK no games row for seed:espn:' + EVENT_ID);
    await redis.quit();
    return;
  }
  const { data: gameTeams, error: teamError } = await supabase
    .from('teams')
    .select('id, abbreviation, name')
    .in('id', [game.home_team_id, game.away_team_id]);
  if (teamError) throw new Error(teamError.message);
  const abbrToUuid = new Map<string, string>();
  for (const team of gameTeams ?? []) abbrToUuid.set(team.abbreviation, team.id);
  log(
    `  games.id=${game.id} week=${game.week} status=${game.status} sportradar_id=${game.sportradar_id}`,
  );
  log(
    `  db teams ${[...(gameTeams ?? [])].map((team) => `${team.abbreviation}=${team.id}`).join(' ')}`,
  );

  log(
    'checkpoint users  services/api/src/lib/lineup-sync.ts:263 services/api/src/lib/worker-cycle.ts:50',
  );
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, email, subscription_tier, preferences')
    .eq('email', EMAIL)
    .maybeSingle();
  if (userError) throw new Error(userError.message);
  if (!user) {
    log(`  FIRST_BREAK no users row for ${EMAIL}`);
    await redis.quit();
    return;
  }
  const prefs = parsePreferences(user.preferences);
  const { data: leagues, error: leaguesError } = await supabase
    .from('leagues')
    .select('id, name, platform, lineup_source, last_synced_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });
  if (leaguesError) throw new Error(leaguesError.message);
  const { resolveWatchedLeagueIds } = await loadModule<{
    resolveWatchedLeagueIds(input: {
      preferences: ReturnType<typeof parsePreferences>;
      subscriptionTier: string;
      ownedLeagueIds: string[];
    }): string[];
  }>('../services/api/src/lib/watched-leagues.ts');
  const ownedIds = (leagues ?? []).map((league) => league.id);
  const watchedIds = resolveWatchedLeagueIds({
    preferences: prefs,
    subscriptionTier: user.subscription_tier,
    ownedLeagueIds: ownedIds,
  });
  const watched = new Set(watchedIds);
  log(
    `  user=${user.id} tier=${user.subscription_tier} watched=${watchedIds.join(',') || '(none)'} prefs=${prefs.watchedLeagueIds.join(',') || '(empty)'}`,
  );
  for (const league of leagues ?? []) {
    log(
      `  league name=${JSON.stringify(league.name)} platform=${league.platform} source=${league.lineup_source ?? 'null'} watched=${watched.has(league.id)} synced=${league.last_synced_at ?? 'never'}`,
    );
  }
  const workerWouldSync = (leagues ?? []).filter((league) => league.platform === 'sleeper');
  log(
    `  worker selects platform=sleeper only (worker-cycle.ts:53); sleeper leagues=${workerWouldSync.length}`,
  );

  const watchedLeagueIds = (leagues ?? [])
    .filter((league) => watched.has(league.id))
    .map((l) => l.id);
  const { data: slots, error: slotsError } = await supabase
    .from('lineup_slots')
    .select(
      'league_id, week, slot_type, player_id, players(first_name, last_name, position, team_id)',
    )
    .in(
      'league_id',
      watchedLeagueIds.length > 0 ? watchedLeagueIds : ['00000000-0000-0000-0000-000000000000'],
    )
    .eq('week', game.week)
    .in('slot_type', ['starter', 'flex']);
  if (slotsError) throw new Error(slotsError.message);
  const slotPlayers = (slots ?? []).map((slot) => ({
    slot_type: slot.slot_type,
    player: asPlayer(slot.players),
  }));
  const teamIds = [
    ...new Set(
      slotPlayers
        .map((slot) => slot.player?.team_id)
        .filter((id): id is string => typeof id === 'string'),
    ),
  ];
  const { data: slotTeams, error: slotTeamError } = await supabase
    .from('teams')
    .select('id, abbreviation')
    .in('id', teamIds.length > 0 ? teamIds : ['00000000-0000-0000-0000-000000000000']);
  if (slotTeamError) throw new Error(slotTeamError.message);
  const teamAbbr = new Map((slotTeams ?? []).map((team) => [team.id, team.abbreviation]));
  log(`  watched starter/flex slots for week ${game.week}: ${slotPlayers.length}`);
  for (const slot of slotPlayers) {
    const player = slot.player;
    const abbr = player ? teamAbbr.get(player.team_id) : undefined;
    log(
      `    ${player?.first_name ?? '?'} ${player?.last_name ?? '?'} ${player?.position ?? '?'} team=${abbr ?? '?'} ${player?.team_id ?? '?'} slot=${slot.slot_type}`,
    );
  }

  log(
    'checkpoint team translation  services/ingestion/src/espn/translatePlay.ts:12 services/api/src/runner/supabaseCatalogs.ts:32',
  );
  const homeUuid = abbrToUuid.get(context.homeTeamId);
  const awayUuid = abbrToUuid.get(context.awayTeamId);
  log(`  ESPN ${context.homeTeamId} -> ${homeUuid ?? 'UNMAPPED'} (db home ${game.home_team_id})`);
  log(`  ESPN ${context.awayTeamId} -> ${awayUuid ?? 'UNMAPPED'} (db away ${game.away_team_id})`);
  const cookSlot = slotPlayers.find(
    (slot) => slot.player?.last_name === 'Cook' && slot.player?.first_name === 'James',
  );
  log(
    `  James Cook slot team_id=${cookSlot?.player?.team_id ?? 'not in watched week-' + game.week + ' starters'} abbr=${cookSlot?.player ? teamAbbr.get(cookSlot.player.team_id) : 'n/a'}`,
  );
  const cookMatchesBuf =
    cookSlot?.player?.team_id !== undefined && cookSlot.player.team_id === homeUuid;
  log(`  Cook team_id === BUF games.home_team_id: ${cookMatchesBuf}`);

  log(
    `  services/api/.env CACHE_DRIVER=${process.env['CACHE_DRIVER'] ?? '(unset)'} REDIS_URL=${process.env['REDIS_URL'] ? 'set' : 'unset'}`,
  );
  log(
    '  worker writes users_with_stake only when CACHE_DRIVER=redis and REDIS_URL is set (cache/index.ts:11). Otherwise the lineup cache is in-memory.',
  );
  log(
    'checkpoint redis stake and lineup  services/engine/src/onPlayEvent.ts:33 services/api/src/runner/tcpRedis.ts:151',
  );
  const gameStateKeys = await scanKeys(redis, 'game_state:*');
  log(`  game_state keys=${gameStateKeys.length} (runner discovery writes these)`);
  const nflRaw = await redis.get('current_nfl_state');
  log(`  current_nfl_state=${nflRaw ?? 'missing'}`);
  const stakeKeys = await scanKeys(redis, 'users_with_stake:*');
  log(`  users_with_stake keys=${stakeKeys.length}`);
  const userStakeKeys: string[] = [];
  for (const key of stakeKeys) {
    const members = await redis.smembers(key);
    if (members.includes(user.id)) userStakeKeys.push(`${key} size=${members.length}`);
  }
  log(
    `  keys containing this user: ${userStakeKeys.length === 0 ? '(none)' : userStakeKeys.join(' | ')}`,
  );
  for (const teamId of [homeUuid, awayUuid]) {
    if (!teamId) continue;
    const members = await redis.smembers(`users_with_stake:${teamId}`);
    log(
      `  users_with_stake:${teamId} size=${members.length} includes_user=${members.includes(user.id)}`,
    );
  }
  const cacheKeys = await scanKeys(redis, `user_lineup_cache:${user.id}:*`);
  log(`  lineup cache keys for user: ${cacheKeys.length === 0 ? '(none)' : cacheKeys.join(' ')}`);
  const cacheRaw = await redis.get(`user_lineup_cache:${user.id}:${game.week}`);
  log(
    `  user_lineup_cache:${user.id}:${game.week} ${cacheRaw === null ? 'MISSING' : `bytes=${cacheRaw.length}`}`,
  );
  const seenCount = await redis.scard(`espn_seen_plays:${EVENT_ID}`);
  log(
    `  espn_seen_plays:${EVENT_ID} size=${seenCount} summary_plays=${summaryPlayIds(summary).length} (followGame.ts:47 seeds the first summary and does not call onPlayEvent)`,
  );

  const store = new InMemoryGameStateStore();
  for (const teamId of [homeUuid, awayUuid]) {
    if (!teamId) continue;
    for (const member of await redis.smembers(`users_with_stake:${teamId}`)) {
      store.addStake(teamId, member);
    }
  }

  let cacheHits = 0;
  let cacheMisses = 0;
  let stakeCalls = 0;
  let lastStakeUsers: string[] = [];
  const lineupCache = {
    async getLineupCache(userId: string, week: number) {
      const raw = await redis.get(`user_lineup_cache:${userId}:${week}`);
      if (raw === null) {
        cacheMisses += 1;
        return null;
      }
      cacheHits += 1;
      return deserializeUserLineupCache(JSON.parse(raw));
    },
  };
  const loggingState = {
    getGameState: (gameId: string) => store.getGameState(gameId),
    setGameState: (gameId: string, state: Parameters<InMemoryGameStateStore['setGameState']>[1]) =>
      store.setGameState(gameId, state),
    getUserFlagState: (userId: string, gameId: string) => store.getUserFlagState(userId, gameId),
    setUserFlagState: (
      userId: string,
      gameId: string,
      state: Parameters<InMemoryGameStateStore['setUserFlagState']>[2],
    ) => store.setUserFlagState(userId, gameId, state),
    getActiveUsers: () => store.getActiveUsers(),
    async getUsersWithStakeIn(teamId: string) {
      stakeCalls += 1;
      const members = await store.getUsersWithStakeIn(teamId);
      lastStakeUsers = members;
      return members;
    },
    markUserActive: (userId: string, ttlMs: number) => store.markUserActive(userId, ttlMs),
    removeActiveUser: (userId: string) => store.removeActiveUser(userId),
    isUserActive: (userId: string) => store.isUserActive(userId),
    sweepExpiredActiveUsers: () => store.sweepExpiredActiveUsers(),
  };

  const innerQueue = new InMemoryFlagEventQueue();
  const enqueued: Array<{ type: FlagEvent['type']; userId: string; playId: string | null }> = [];
  const queue: FlagEventQueue = {
    async enqueue(event: FlagEvent, triggeringPlayId: string | null = null): Promise<void> {
      enqueued.push({ type: event.type, userId: event.userId, playId: triggeringPlayId });
      await innerQueue.enqueue(event, triggeringPlayId);
    },
    due: (now: number, limit: number) => innerQueue.due(now, limit),
    remove: (item: QueuedFlagEvent) => innerQueue.remove(item),
  };

  const users = new InMemoryUserDirectory();
  users.setUser({
    id: user.id,
    subscriptionTier: user.subscription_tier === 'pro' ? 'pro' : 'free',
    preferences: prefs,
    expoPushToken: null,
  });
  const catalog = new InMemoryGameCatalog();
  const home = (gameTeams ?? []).find((team) => team.id === game.home_team_id);
  const away = (gameTeams ?? []).find((team) => team.id === game.away_team_id);
  catalog.setGame(game.id, {
    homeTeamAbbreviation: home?.abbreviation ?? '',
    awayTeamAbbreviation: away?.abbreviation ?? '',
    homeTeamName: home?.name ?? '',
    awayTeamName: away?.name ?? '',
    homeTeamPrimaryColor: '',
    homeTeamSecondaryColor: '',
    awayTeamPrimaryColor: '',
    awayTeamSecondaryColor: '',
  });
  const persistence = new InMemoryFlagEventPersistence();
  let clockNow = 1_700_000_000_000;
  const clock = (): number => clockNow;
  const gate = new ResumptionGatedDispatcher({ queue, clock, onGated: () => undefined });
  const { createPlaySession } = await loadModule<{
    createPlaySession: (deps: {
      gameId: string;
      gate: ResumptionGatedDispatcher;
      ceiling: ResumptionCeiling;
      clock: () => number;
      onPlay: {
        lineupCache: typeof lineupCache;
        gameState: typeof loggingState;
        dispatcher: ResumptionGatedDispatcher;
        clock: () => number;
      };
    }) => {
      handlePlay(play: PlayEvent): Promise<void>;
      tracker: { applyWallClockCeiling(at: number): void };
      dispose(): void;
    };
  }>('../services/api/src/runner/playSession.ts');
  const sessionHolder: {
    tracker?: { applyWallClockCeiling(at: number): void };
  } = {};
  const ceiling = new ResumptionCeiling({
    store: new InMemoryResumptionOpenStore(),
    clock,
    onFire: (gameId) => {
      sessionHolder.tracker?.applyWallClockCeiling(clock());
      log(`  ceiling fire ${gameId}`);
    },
  });
  const session = createPlaySession({
    gameId: game.id,
    gate,
    ceiling,
    clock,
    onPlay: { lineupCache, gameState: loggingState, dispatcher: gate, clock },
  });
  sessionHolder.tracker = session.tracker;
  const delivery: DeliveryDeps = {
    gameStateStore: loggingState,
    gameCatalog: catalog,
    playerCatalog: new InMemoryPlayerCatalog(),
    broadcastCatalog: new InMemoryBroadcastCatalog(),
    userDirectory: users,
    persistence,
    realtimeBus: new InMemoryRealtimeBus(),
    rateLimitStore: new InMemoryRateLimitStore(),
    pushNotifier: createPushNotifier({ pushDriver: 'none' }),
    clock,
  };

  log(
    'checkpoint plays  services/api/src/runner/playSession.ts:52 services/engine/src/onPlayEvent.ts:56',
  );
  const drives = [
    ...(summary.drives?.previous ?? []),
    ...(summary.drives?.current ? [summary.drives.current] : []),
  ];
  let playIndex = 0;
  let interesting = 0;
  let userSeenOnStake = 0;
  const persistedBefore = persistence.records.length;
  for (const drive of drives) {
    for (const play of drive.plays ?? []) {
      const isFinalPlay = false;
      const mapped = translatePlay(
        mapEspnPlay(play, drive, { ...context, gameId: EVENT_ID }, isFinalPlay),
        game.id,
        abbrToUuid,
      );
      const withWeek = { ...mapped, week: game.week };
      clockNow += 1000;
      lastStakeUsers = [];
      const stakeBefore = stakeCalls;
      const missesBefore = cacheMisses;
      const enqueuedBefore = enqueued.length;
      await session.handlePlay(withWeek);
      const tick = await runDispatcherTick({
        queue,
        gameStateStore: loggingState,
        userDirectory: users,
        rateLimitStore: delivery.rateLimitStore,
        delivery,
        clock,
      });
      const askedStake = stakeCalls > stakeBefore;
      if (askedStake) interesting += 1;
      if (lastStakeUsers.includes(user.id)) userSeenOnStake += 1;
      const newEvents = enqueued.slice(enqueuedBefore);
      if (askedStake || newEvents.length > 0 || tick.delivered > 0) {
        log(
          `  play ${play.id} type=${withWeek.playType} possession=${withWeek.possessionTeamId} interesting=${askedStake} stake=[${lastStakeUsers.join(',')}] cacheMisses+${cacheMisses - missesBefore} enqueued=${newEvents.map((event) => event.type).join(',') || '-'} delivered=${tick.delivered} stale=${tick.droppedStale} missingUser=${tick.droppedMissingUser}`,
        );
      }
      playIndex += 1;
    }
  }
  log(
    `  plays=${playIndex} interesting=${interesting} stake_calls_including_user=${userSeenOnStake} cacheHits=${cacheHits} cacheMisses=${cacheMisses} enqueued=${enqueued.length} persisted=${persistence.records.length - persistedBefore}`,
  );
  if (userSeenOnStake === 0) {
    log(
      '  FIRST_BREAK user-to-game  services/engine/src/onPlayEvent.ts:68 getUsersWithStakeIn never returned this user. Stake sets were copied from Docker Redis and not invented.',
    );
  } else if (cacheMisses > 0 && enqueued.length === 0) {
    log(
      '  FIRST_BREAK lineup cache  services/engine/src/onPlayEvent.ts:74 getLineupCache returned null for a staked user.',
    );
  } else if (enqueued.length === 0) {
    log('  FIRST_BREAK flag diff  services/engine/src/onPlayEvent.ts:79 no event was dispatched.');
  } else if (persistence.records.length === persistedBefore) {
    log(
      '  FIRST_BREAK persistence  services/dispatcher/src/delivery.ts:235 events were enqueued but none were inserted.',
    );
  } else {
    log(`  events reached in-memory persistence: ${persistence.records.length}`);
  }

  session.dispose();
  ceiling.stop();
  gate.stop();
  await redis.quit();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
