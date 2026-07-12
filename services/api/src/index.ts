import { env } from './env.js';
import { buildServer } from './server.js';

const fastify = await buildServer(env);

try {
  await fastify.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (error) {
  fastify.log.error(error);
  process.exit(1);
}
