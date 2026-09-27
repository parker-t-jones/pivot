import { env } from './env.js';
import { memoryCacheRefusal, productionRedisRefusal } from './runner/redisGuard.js';
import { buildServer } from './server.js';

const memoryBlocked = memoryCacheRefusal({
  cacheDriver: env.CACHE_DRIVER,
  nodeEnv: process.env['NODE_ENV'],
});
if (memoryBlocked !== null) {
  console.error(`[api] ${memoryBlocked}`);
  process.exit(1);
}

const blocked = productionRedisRefusal({
  urls: [env.REDIS_URL, env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_TCP_URL],
  productionHost: process.env['PRODUCTION_REDIS_HOST'],
  nodeEnv: process.env['NODE_ENV'],
});
if (blocked !== null) {
  console.error(`[api] ${blocked}`);
  process.exit(1);
}

const fastify = await buildServer(env);

try {
  await fastify.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (error) {
  fastify.log.error(error);
  process.exit(1);
}
