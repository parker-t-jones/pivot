/**
 * THROWAWAY local injector — not part of the Pivot app, not production code.
 *
 * Sends `flag_added` through the same gates as a dispatcher tick: freshness, quiet hours,
 * notification mode, the 3-per-60s rate limit, then `deliverFlagEvent` (Expo and Web Push,
 * collapse key, per-device suppression). It does not enqueue on the live queue and it does
 * not retry older failed pushes.
 *
 * Refuses unless SUPABASE_URL, EXPO_PUBLIC_API_BASE_URL, and REDIS_URL are localhost or
 * 127.0.0.1. REDIS_URL is included because this writes `user_flag_state` and a rate-limit row.
 *
 *   pnpm tsx experiments/send-test-flag.ts --user <uuid> --game <id> [--count 1]
 *
 * Device lines come from the real send: `[push] ios device=... result=...` and
 * `[web-push] device=... result=...`. A rate-limited event prints those lines here and
 * does not call the send. `result=rate_limited` also covers quiet hours and notification mode.
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import type { FlagEvent, FlagState } from '@pivot/shared';
import {
  createPushNotifier,
  createWebPushSender,
  deliverFlagEvent,
  isStillRelevant,
  shouldRateLimit,
  webPushCollapseKey,
  type DeliveryDeps,
  type GameStateStore,
  type UserDirectory,
  type RateLimitStore,
  type WebPushSubscription,
} from '@pivot/dispatcher';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, '../services/api');
const APP_DIR = path.resolve(__dirname, '../app');

const USAGE =
  'pnpm tsx experiments/send-test-flag.ts --user <uuid> --game <id> [--count 1]';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv: string[]): { userId: string; gameId: string; count: number } {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === undefined || value === undefined || !flag.startsWith('--')) fail(USAGE);
    values.set(flag, value);
  }
  const userId = values.get('--user');
  const gameId = values.get('--game');
  if (!userId || !gameId) fail(USAGE);
  const count = Number(values.get('--count') ?? '1');
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    fail('--count must be an integer from 1 to 20');
  }
  return { userId, gameId, count };
}

interface LoadedApi {
  env: {
    SUPABASE_URL: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    REDIS_URL?: string;
    UPSTASH_REDIS_TCP_URL?: string;
    PUSH_DRIVER: 'expo' | 'none';
    EXPO_ACCESS_TOKEN?: string;
    VAPID_SUBJECT?: string;
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
  };
  createSupabaseServiceClient: (env: LoadedApi['env']) => unknown;
  tcpRedisUrl: (env: LoadedApi['env']) => string | undefined;
  createTcpRedis: (url: string) => { quit: () => Promise<unknown> };
  tcpGameState: (redis: unknown) => GameStateStore;
  tcpRateLimit: (redis: unknown) => RateLimitStore;
  tcpRealtimeBus: (redis: unknown) => DeliveryDeps['realtimeBus'];
  SupabaseUserDirectory: new (client: unknown) => UserDirectory;
  SupabaseGameCatalog: new (client: unknown) => DeliveryDeps['gameCatalog'];
  SupabasePlayerCatalog: new (client: unknown) => DeliveryDeps['playerCatalog'];
  SupabaseBroadcastCatalog: new (client: unknown) => DeliveryDeps['broadcastCatalog'];
  SupabaseFlagEventPersistence: new (client: unknown) => DeliveryDeps['persistence'];
  SupabaseWebPushSubscriptionStore: new (client: unknown) => {
    listForUser: (userId: string) => Promise<WebPushSubscription[]>;
  } & NonNullable<DeliveryDeps['webPush']>['subscriptions'];
  localUrlRefusal: (name: string, raw: string | undefined) => string | null;
}

async function loadApi(): Promise<LoadedApi> {
  const mod = (file: string): string => path.join(API_DIR, 'src', file);
  const envMod = (await import(mod('env.js'))) as { env: LoadedApi['env'] };
  const supabaseMod = (await import(mod('lib/supabase.js'))) as {
    createSupabaseServiceClient: LoadedApi['createSupabaseServiceClient'];
  };
  const tcpMod = (await import(mod('runner/tcpRedis.js'))) as Pick<
    LoadedApi,
    'tcpRedisUrl' | 'createTcpRedis' | 'tcpGameState' | 'tcpRateLimit' | 'tcpRealtimeBus'
  >;
  const catalogs = (await import(mod('runner/supabaseCatalogs.js'))) as Pick<
    LoadedApi,
    | 'SupabaseUserDirectory'
    | 'SupabaseGameCatalog'
    | 'SupabasePlayerCatalog'
    | 'SupabaseBroadcastCatalog'
  >;
  const persistence = (await import(mod('runner/supabaseFlagEventPersistence.js'))) as {
    SupabaseFlagEventPersistence: LoadedApi['SupabaseFlagEventPersistence'];
  };
  const webSubs = (await import(mod('runner/webPushSubscriptions.js'))) as {
    SupabaseWebPushSubscriptionStore: LoadedApi['SupabaseWebPushSubscriptionStore'];
  };
  const local = (await import(mod('lib/localStack.js'))) as {
    localUrlRefusal: LoadedApi['localUrlRefusal'];
  };
  return {
    env: envMod.env,
    createSupabaseServiceClient: supabaseMod.createSupabaseServiceClient,
    tcpRedisUrl: tcpMod.tcpRedisUrl,
    createTcpRedis: tcpMod.createTcpRedis,
    tcpGameState: tcpMod.tcpGameState,
    tcpRateLimit: tcpMod.tcpRateLimit,
    tcpRealtimeBus: tcpMod.tcpRealtimeBus,
    SupabaseUserDirectory: catalogs.SupabaseUserDirectory,
    SupabaseGameCatalog: catalogs.SupabaseGameCatalog,
    SupabasePlayerCatalog: catalogs.SupabasePlayerCatalog,
    SupabaseBroadcastCatalog: catalogs.SupabaseBroadcastCatalog,
    SupabaseFlagEventPersistence: persistence.SupabaseFlagEventPersistence,
    SupabaseWebPushSubscriptionStore: webSubs.SupabaseWebPushSubscriptionStore,
    localUrlRefusal: local.localUrlRefusal,
  };
}

function flagState(gameId: string, computedAt: number): FlagState {
  return {
    gameId,
    flagged: true,
    priorityScore: 1,
    reasons: [{ type: 'offense_active', triggeringPlayerIds: [] }],
    computedAt,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadEnv({ path: path.join(API_DIR, '.env'), quiet: true });
  loadEnv({ path: path.join(API_DIR, '.env.local'), quiet: true });
  loadEnv({ path: path.join(APP_DIR, '.env'), quiet: true });
  loadEnv({ path: path.join(APP_DIR, '.env.local'), quiet: true });

  const api = await loadApi();
  for (const [name, raw] of [
    ['SUPABASE_URL', process.env['SUPABASE_URL']],
    ['EXPO_PUBLIC_API_BASE_URL', process.env['EXPO_PUBLIC_API_BASE_URL']],
    ['REDIS_URL', process.env['REDIS_URL']],
  ] as const) {
    const refusal = api.localUrlRefusal(name, raw);
    if (refusal !== null) fail(refusal);
  }

  const redisUrl = api.tcpRedisUrl(api.env);
  if (redisUrl === undefined) fail('REDIS_URL is not set');
  const redis = api.createTcpRedis(redisUrl);
  try {
    const supabase = api.createSupabaseServiceClient(api.env);
    const users = new api.SupabaseUserDirectory(supabase);
    const user = await users.getUser(args.userId);
    if (!user) fail(`no user ${args.userId}`);
    const gameState = api.tcpGameState(redis);
    const rateLimit = api.tcpRateLimit(redis);
    const subscriptions = new api.SupabaseWebPushSubscriptionStore(supabase);
    const sender = createWebPushSender({
      subject: api.env.VAPID_SUBJECT,
      publicKey: api.env.VAPID_PUBLIC_KEY,
      privateKey: api.env.VAPID_PRIVATE_KEY,
    });
    const iosDevice = user.expoPushDeviceId ?? 'legacy-ios';
    const deps: DeliveryDeps = {
      gameStateStore: gameState,
      gameCatalog: new api.SupabaseGameCatalog(supabase),
      playerCatalog: new api.SupabasePlayerCatalog(supabase),
      broadcastCatalog: new api.SupabaseBroadcastCatalog(supabase),
      userDirectory: users,
      persistence: new api.SupabaseFlagEventPersistence(supabase),
      realtimeBus: api.tcpRealtimeBus(redis),
      rateLimitStore: rateLimit,
      pushNotifier: createPushNotifier({
        pushDriver: api.env.PUSH_DRIVER,
        expoAccessToken: api.env.EXPO_ACCESS_TOKEN,
      }),
      ...(sender ? { webPush: { sender, subscriptions } } : {}),
    };

    console.log(
      `[send-test-flag] user=${args.userId} game=${args.gameId} count=${args.count} collapse=${webPushCollapseKey(args.userId)} ios=${iosDevice} webPush=${sender ? 'enabled' : 'disabled'}`,
    );
    console.log(
      '[send-test-flag] wrote user_flag_state for each event so the freshness gate accepts it. A flag already queued for this game can be dropped as stale.',
    );

    for (let i = 1; i <= args.count; i += 1) {
      const now = Date.now();
      const state = flagState(args.gameId, now);
      const event: FlagEvent = {
        id: randomUUID(),
        userId: args.userId,
        gameId: args.gameId,
        type: 'flag_added',
        oldState: null,
        newState: state,
        scheduledFireAt: now,
        enqueuedAt: new Date(now).toISOString(),
      };
      await gameState.setUserFlagState(args.userId, args.gameId, state);
      const current = await gameState.getUserFlagState(args.userId, args.gameId);
      console.log(`[send-test-flag] ${i}/${args.count} event=${event.id}`);
      if (!isStillRelevant(event, current)) {
        console.log(`[send-test-flag] ios device=${iosDevice} result=dropped_stale`);
        continue;
      }
      if (await shouldRateLimit(event, user.preferences, rateLimit, now)) {
        console.log(`[send-test-flag] ios device=${iosDevice} result=rate_limited`);
        for (const sub of await subscriptions.listForUser(args.userId)) {
          console.log(`[send-test-flag] web device=${sub.deviceId} result=rate_limited`);
        }
        continue;
      }
      await deliverFlagEvent(deps, event, user);
    }
  } finally {
    await redis.quit();
  }
}

await main();
