import { randomUUID } from 'node:crypto';
import {
  createPushNotifier,
  deliverFlagEvent,
  InMemoryBroadcastCatalog,
  InMemoryFlagEventPersistence,
  InMemoryGameCatalog,
  InMemoryPlayerCatalog,
  InMemoryRateLimitStore,
  InMemoryUserDirectory,
  type GameStateStore,
  type RealtimeBus,
  type RealtimeSubscriber,
} from '@pivot/dispatcher';
import { parsePreferences } from '@pivot/shared';
import { ApiError } from './errors.js';
import { loadSubscribedServices, userIsDemo } from './demoAccount.js';
import {
  DEMO_LIVE_GAME_ID,
  demoAlertEvent,
  demoAlertPlayers,
  demoLiveGameState,
  demoLiveSummaryInfo,
  demoWeekAirings,
} from './demoFixture.js';
import type { SupabaseServiceClient } from './supabase.js';

/**
 * Same 3-per-minute window as `shouldRateLimit`. This route does not call `shouldRateLimit`:
 * quiet hours and `notificationMode` do not apply to an explicit demo-alert tap.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 3;

export const DEMO_ALERT_NO_TOKEN = 'demo_alert_no_token';
export const DEMO_ALERT_RATE_LIMITED = 'demo_alert_rate_limited';
export const DEMO_ALERT_NO_TOKEN_MESSAGE = 'Turn on notifications to see a demo alert';
export const DEMO_ALERT_RATE_LIMITED_MESSAGE = 'Try again in a minute';

let rateLimitStore = new InMemoryRateLimitStore();

export function resetDemoAlertRateLimit(): void {
  rateLimitStore = new InMemoryRateLimitStore();
}

function publishBus(subscriber: RealtimeSubscriber): RealtimeBus {
  const publish = (subscriber as { publish?: RealtimeBus['publish'] }).publish;
  if (typeof publish === 'function') {
    return {
      publish: (channel, message) => publish.call(subscriber, channel, message),
    };
  }
  return {
    async publish() {
      return undefined;
    },
  };
}

/**
 * One demo push through `deliverFlagEvent`. Does not insert `flag_events` (the fixture game id
 * is not a `games` row) and does not write Redis `game_state`.
 */
export async function sendDemoAccountAlert(input: {
  supabase: SupabaseServiceClient;
  userId: string;
  gameStateStore: Pick<GameStateStore, 'getGameState' | 'isUserActive' | 'isDeviceActive'>;
  realtimeSubscriber: RealtimeSubscriber;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  if (!(await userIsDemo(input.supabase, input.userId))) {
    throw new ApiError(404, 'not_found', 'Not found.');
  }

  const { data: row, error } = await input.supabase
    .from('users')
    .select('expo_push_token, expo_push_device_id, preferences, subscription_tier')
    .eq('id', input.userId)
    .single();
  if (error) throw error;
  if (!row.expo_push_token) {
    throw new ApiError(409, DEMO_ALERT_NO_TOKEN, DEMO_ALERT_NO_TOKEN_MESSAGE);
  }

  const recent = await rateLimitStore.countRecentNotifications(
    input.userId,
    now.getTime() - WINDOW_MS,
    now.getTime(),
  );
  if (recent >= MAX_PER_WINDOW) {
    throw new ApiError(429, DEMO_ALERT_RATE_LIMITED, DEMO_ALERT_RATE_LIMITED_MESSAGE);
  }

  const services = await loadSubscribedServices(input.supabase, input.userId);
  const games = new InMemoryGameCatalog();
  games.setGame(DEMO_LIVE_GAME_ID, demoLiveSummaryInfo());
  const players = new InMemoryPlayerCatalog();
  for (const player of demoAlertPlayers()) players.setPlayer(player);
  const broadcasts = new InMemoryBroadcastCatalog();
  broadcasts.setWeekAirings(demoWeekAirings(now));
  broadcasts.setUserSubscribedServices(input.userId, [...services]);
  // Explicit tap: ignore stored notification mode and quiet hours. The 3-per-minute cap above still applies.
  const stored = parsePreferences(row.preferences);
  const preferences = {
    ...stored,
    notificationMode: 'all' as const,
    quietHours: { ...stored.quietHours, enabled: false },
  };
  const directory = new InMemoryUserDirectory();
  directory.setUser({
    id: input.userId,
    subscriptionTier: row.subscription_tier === 'pro' ? 'pro' : 'free',
    preferences,
    expoPushToken: row.expo_push_token,
    expoPushDeviceId: row.expo_push_device_id,
  });

  const liveState = demoLiveGameState(now);
  const pushDriver = process.env['PUSH_DRIVER'] === 'expo' ? 'expo' : 'none';
  await deliverFlagEvent(
    {
      gameStateStore: {
        getGameState: async (gameId) =>
          gameId === DEMO_LIVE_GAME_ID ? liveState : input.gameStateStore.getGameState(gameId),
        isUserActive: (userId) => input.gameStateStore.isUserActive(userId),
        isDeviceActive: (userId, deviceId) => input.gameStateStore.isDeviceActive(userId, deviceId),
      },
      gameCatalog: games,
      playerCatalog: players,
      broadcastCatalog: broadcasts,
      userDirectory: directory,
      persistence: new InMemoryFlagEventPersistence(),
      realtimeBus: publishBus(input.realtimeSubscriber),
      rateLimitStore,
      pushNotifier: createPushNotifier({
        pushDriver,
        expoAccessToken: process.env['EXPO_ACCESS_TOKEN'],
      }),
      clock: () => now.getTime(),
    },
    demoAlertEvent(input.userId, now),
    {
      id: input.userId,
      subscriptionTier: row.subscription_tier === 'pro' ? 'pro' : 'free',
      preferences,
      expoPushToken: row.expo_push_token,
      expoPushDeviceId: row.expo_push_device_id,
    },
    randomUUID(),
  );
}
