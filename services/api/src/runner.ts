import { hostname } from 'node:os';
import { createPushNotifier, createWebPushSender } from '@pivot/dispatcher';
import { espnClient } from '@pivot/ingestion';
import { TcpLineupCache } from './cache/tcp.js';
import { env } from './env.js';
import { warnIfWebPushDisabled } from './lib/vapidConfig.js';
import { createSupabaseServiceClient } from './lib/supabase.js';
import { leaderOwner } from './runner/leaderLock.js';
import { startLiveRunner } from './runner/liveRunner.js';
import { SupabaseSavedGameLinkLookup } from './runner/savedGameLinks.js';
import { SupabaseWebPushSubscriptionStore } from './runner/webPushSubscriptions.js';
import { guardRunnerStart } from './runner/redisGuard.js';
import { SupabaseFlagEventPersistence } from './runner/supabaseFlagEventPersistence.js';
import {
  SupabaseBroadcastCatalog,
  SupabaseGameAiringsStore,
  SupabaseGameCatalog,
  SupabaseGameDirectory,
  SupabasePlayerCatalog,
  SupabaseUserDirectory,
} from './runner/supabaseCatalogs.js';
import {
  createTcpRedis,
  tcpFiredClaims,
  tcpFlagEventQueue,
  tcpGameState,
  tcpLeaderLock,
  tcpRunnerHeartbeat,
  tcpRateLimit,
  tcpRealtimeBus,
  tcpRedisUrl,
  tcpResumptionOpenStore,
  tcpSeenPlays,
} from './runner/tcpRedis.js';

warnIfWebPushDisabled(env);

const redisUrls = [env.REDIS_URL, env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_TCP_URL];
const blocked = guardRunnerStart({
  cacheDriver: env.CACHE_DRIVER,
  nodeEnv: process.env['NODE_ENV'],
  productionHost: process.env['PRODUCTION_REDIS_HOST'],
  redisUrls,
});
if (blocked !== null) {
  console.error(`[runner] ${blocked}`);
  process.exit(1);
}

const tcpUrl = tcpRedisUrl(env);
if (tcpUrl === undefined) {
  console.error('[runner] REDIS_URL or UPSTASH_REDIS_TCP_URL is required');
  process.exit(1);
}

const redis = createTcpRedis(tcpUrl);
const supabase = createSupabaseServiceClient(env);
const lineupCache = new TcpLineupCache(redis);
const webPushSender = createWebPushSender({
  subject: env.VAPID_SUBJECT,
  publicKey: env.VAPID_PUBLIC_KEY,
  privateKey: env.VAPID_PRIVATE_KEY,
});
const handle = startLiveRunner({
  lock: tcpLeaderLock(redis),
  heartbeat: tcpRunnerHeartbeat(redis),
  seen: tcpSeenPlays(redis),
  queue: tcpFlagEventQueue(redis),
  ceilingStore: tcpResumptionOpenStore(redis),
  gameState: tcpGameState(redis),
  rateLimit: tcpRateLimit(redis),
  realtime: tcpRealtimeBus(redis),
  lineupCache,
  stakeCache: { supabase, lineupCache },
  firedClaims: tcpFiredClaims(redis),
  games: new SupabaseGameDirectory(supabase),
  users: new SupabaseUserDirectory(supabase),
  gameCatalog: new SupabaseGameCatalog(supabase),
  players: new SupabasePlayerCatalog(supabase),
  broadcasts: new SupabaseBroadcastCatalog(supabase),
  airings: new SupabaseGameAiringsStore(supabase),
  persistence: new SupabaseFlagEventPersistence(supabase),
  pushNotifier: createPushNotifier({
    pushDriver: env.PUSH_DRIVER,
    expoAccessToken: env.EXPO_ACCESS_TOKEN,
  }),
  ...(webPushSender
    ? {
        webPush: {
          sender: webPushSender,
          subscriptions: new SupabaseWebPushSubscriptionStore(supabase),
          savedLinks: new SupabaseSavedGameLinkLookup(supabase),
        },
      }
    : {}),
  scoreboard: espnClient,
  owner: leaderOwner(process.env['FLY_MACHINE_ID'], hostname(), process.pid),
});

let stopping = false;
const shutdown = (): void => {
  if (stopping) return;
  stopping = true;
  console.log('[runner] stopping');
  handle.stop();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

try {
  await handle.done;
} finally {
  await redis.quit();
}
