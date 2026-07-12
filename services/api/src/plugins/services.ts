import fp from 'fastify-plugin';
import type { LineupCacheProvider } from '../cache/index.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';

declare module 'fastify' {
  interface FastifyInstance {
    supabase: SupabaseServiceClient;
    lineupCache: LineupCacheProvider;
  }
}

interface ServicesPluginOptions {
  supabase: SupabaseServiceClient;
  lineupCache: LineupCacheProvider;
}

/** Decorates the Fastify instance with the shared Supabase service client and lineup cache. */
export default fp<ServicesPluginOptions>(async (fastify, options) => {
  fastify.decorate('supabase', options.supabase);
  fastify.decorate('lineupCache', options.lineupCache);
});
