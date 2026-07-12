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
import leaguesRoutes from './routes/leagues.js';
import playersRoutes from './routes/players.js';
import sleeperRoutes from './routes/sleeper.js';

export interface BuildServerDeps {
  supabase?: SupabaseServiceClient;
  lineupCache?: LineupCacheProvider;
}

export async function buildServer(env: Env, deps: BuildServerDeps = {}) {
  const supabase = deps.supabase ?? createSupabaseServiceClient(env);
  const lineupCache = deps.lineupCache ?? createLineupCacheProvider(env);

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
  await fastify.register(servicesPlugin, { supabase, lineupCache });

  await fastify.register(sleeperRoutes);
  await fastify.register(leaguesRoutes);
  await fastify.register(playersRoutes);

  return fastify;
}
