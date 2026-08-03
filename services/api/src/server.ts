import {
  createGameStateStore,
  createRealtimeChannels,
  type GameStateStore,
  type RealtimeSubscriber,
} from '@fantasy-focus/dispatcher';
import websocketPlugin from '@fastify/websocket';
import Fastify from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { createLineupCacheProvider, type LineupCacheProvider } from './cache/index.js';
import type { Env } from './env.js';
import { ApiError, toErrorBody } from './lib/errors.js';
import { createSupabaseServiceClient, type SupabaseServiceClient } from './lib/supabase.js';
import authPlugin from './plugins/auth.js';
import servicesPlugin from './plugins/services.js';
import flagsRoutes from './routes/flags.js';
import gamesRoutes from './routes/games.js';
import leaguesRoutes from './routes/leagues.js';
import meRoutes from './routes/me.js';
import playersRoutes from './routes/players.js';
import realtimeRoutes from './routes/realtime.js';
import sessionRoutes from './routes/session.js';
import sleeperRoutes from './routes/sleeper.js';
import stateRoutes from './routes/state.js';

export interface BuildServerDeps {
  supabase?: SupabaseServiceClient;
  lineupCache?: LineupCacheProvider;
  gameStateStore?: GameStateStore;
  realtimeSubscriber?: RealtimeSubscriber;
}

function redisConfig(env: Env) {
  return {
    cacheDriver: env.CACHE_DRIVER,
    upstashRestUrl: env.UPSTASH_REDIS_REST_URL,
    upstashRestToken: env.UPSTASH_REDIS_REST_TOKEN,
    upstashTcpUrl: env.UPSTASH_REDIS_TCP_URL,
  };
}

export async function buildServer(env: Env, deps: BuildServerDeps = {}) {
  const supabase = deps.supabase ?? createSupabaseServiceClient(env);
  const lineupCache = deps.lineupCache ?? createLineupCacheProvider(env);
  const gameStateStore = deps.gameStateStore ?? createGameStateStore(redisConfig(env));

  // Only own (and later close) the realtime channels' network connection if the caller didn't
  // inject its own subscriber (tests inject an `InMemoryRealtimeBus`, which needs no teardown).
  let realtimeSubscriber: RealtimeSubscriber;
  let closeRealtimeChannels = async (): Promise<void> => {
    // No owned connection to close — a test/caller injected its own `realtimeSubscriber`.
  };
  if (deps.realtimeSubscriber) {
    realtimeSubscriber = deps.realtimeSubscriber;
  } else {
    const channels = createRealtimeChannels(redisConfig(env));
    realtimeSubscriber = channels.subscriber;
    closeRealtimeChannels = channels.close;
  }

  const fastify = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  fastify.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: {
          code: 'validation_error',
          message: 'Request validation failed.',
          details: error.validation,
        },
      });
    }
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send(toErrorBody(error));
    }
    request.log.error(error);
    return reply
      .status(500)
      .send({ error: { code: 'internal_error', message: 'Internal server error.' } });
  });

  await fastify.register(authPlugin, {
    jwtSecret: env.SUPABASE_JWT_SECRET,
    supabaseUrl: env.SUPABASE_URL,
  });
  await fastify.register(servicesPlugin, {
    supabase,
    lineupCache,
    gameStateStore,
    realtimeSubscriber,
  });
  await fastify.register(websocketPlugin);

  await fastify.register(sleeperRoutes);
  await fastify.register(leaguesRoutes);
  await fastify.register(playersRoutes);
  await fastify.register(flagsRoutes);
  await fastify.register(stateRoutes);
  await fastify.register(gamesRoutes);
  await fastify.register(sessionRoutes);
  await fastify.register(meRoutes);
  await fastify.register(realtimeRoutes, {});

  fastify.addHook('onClose', async () => {
    await closeRealtimeChannels();
  });

  return fastify;
}
