import type { GameStateStore, RealtimeSubscriber } from '@pivot/dispatcher';
import fp from 'fastify-plugin';
import type { LineupCacheProvider } from '../cache/index.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';

declare module 'fastify' {
  interface FastifyInstance {
    supabase: SupabaseServiceClient;
    lineupCache: LineupCacheProvider;
    /** `active_users` lifecycle (Phase 4 WebSocket connect/disconnect, Phase 6 `/session/heartbeat`). */
    gameStateStore: GameStateStore;
    /** Cross-process fan-out relay for `/v1/realtime` (Phase 4) — subscribes to `realtime:user:*` /
     *  `realtime:game:*`; the dispatcher (a separate process/loop) owns the publish side. */
    realtimeSubscriber: RealtimeSubscriber;
  }
}

interface ServicesPluginOptions {
  supabase: SupabaseServiceClient;
  lineupCache: LineupCacheProvider;
  gameStateStore: GameStateStore;
  realtimeSubscriber: RealtimeSubscriber;
}

/** Decorates the Fastify instance with the shared Supabase service client, lineup cache, and the
 *  Phase 4 realtime dependencies. */
export default fp<ServicesPluginOptions>(async (fastify, options) => {
  fastify.decorate('supabase', options.supabase);
  fastify.decorate('lineupCache', options.lineupCache);
  fastify.decorate('gameStateStore', options.gameStateStore);
  fastify.decorate('realtimeSubscriber', options.realtimeSubscriber);
});
