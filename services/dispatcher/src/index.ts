export {
  createGameStateStore,
  InMemoryGameStateStore,
  RedisGameStateProvider,
  type GameStateStore,
  type RedisProviderConfig,
} from './providers/index.js';

export type { Action } from './types.js';

export { type FlagEventQueue, type QueuedFlagEvent } from './queue.js';
export { InMemoryFlagEventQueue } from './inMemoryQueue.js';
export { RedisFlagEventQueue } from './redisQueue.js';

export { isEventStateFresh, isStillRelevant } from './isStillRelevant.js';

export {
  BROADCAST_LAG_SECONDS,
  DEFAULT_LAG_SECONDS,
  InMemoryBroadcastCatalog,
  lagSecondsFor,
  pickBroadcastSource,
  resolveLikelyBroadcastSource,
  type BroadcastCatalog,
  type GameBroadcastOption,
} from './broadcastLag.js';

export {
  InMemoryRateLimitStore,
  NOTIFICATIONS_KEY_TTL_SECONDS,
  isInQuietHours,
  shouldRateLimit,
  type RateLimitStore,
} from './rateLimiter.js';
export { RedisRateLimitStore } from './redisRateLimitStore.js';

export { decideAction, type DecideActionSession, type DecideActionUser } from './decideAction.js';

export {
  InMemoryRealtimeBus,
  RedisRealtimeBus,
  realtimeGameChannel,
  realtimeUserChannel,
  type RealtimeBus,
  type RealtimeMessageHandler,
  type RealtimeSubscriber,
  type RealtimeSubscription,
} from './realtimeBus.js';

export {
  RedisRealtimeSubscriber,
  createRealtimeChannels,
  type RealtimeChannels,
  type RealtimeChannelsConfig,
} from './realtimeSubscriber.js';

export {
  InMemoryFlagEventPersistence,
  InMemoryGameCatalog,
  InMemoryPlayerCatalog,
  InMemoryUserDirectory,
  type DispatchUser,
  type FlagEventPersistence,
  type GameCatalog,
  type GameSummaryInfo,
  type PersistedFlagEventInput,
  type PlayerCatalog,
  type PlayerInfo,
  type UserDirectory,
  type ViewingSessionSnapshot,
} from './catalogs.js';

export { QueueingEventDispatcher, type ScheduleFlagEventDeps } from './scheduleFlagEvent.js';

export { deliverFlagEvent, type DeliveryDeps, type FlagEventEnvelope } from './delivery.js';

export { buildGameSummary, type GameSummary } from './gameSummary.js';

export { ACTIVE_USER_TTL_MS } from './constants.js';

export {
  runDispatcherTick,
  startDispatcherLoop,
  type DispatcherLoopOptions,
  type DispatcherTickDeps,
  type DispatcherTickResult,
} from './dispatcher.js';
