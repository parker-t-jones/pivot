import { InMemoryGameStateStore, InMemoryRealtimeBus } from '@fantasy-focus/dispatcher';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { SignJWT } from 'jose';
import { it, expect } from 'vitest';
import { InMemoryLineupCache } from '../cache/in-memory.js';
import authPlugin from '../plugins/auth.js';
import servicesPlugin from '../plugins/services.js';
import sessionRoutes from './session.js';

const JWT_SECRET = 'test-secret-at-least-32-characters-long';

it('debug', async () => {
  const token = await new SignJWT({ sub: 'user-1', email: 'a@b.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));

  const lineupCache = new InMemoryLineupCache();
  const gameStateStore = new InMemoryGameStateStore();
  const fastify = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  await fastify.register(authPlugin, { jwtSecret: JWT_SECRET, supabaseUrl: 'http://127.0.0.1:54321' });
  await fastify.register(servicesPlugin, {
    supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: '11111111-1111-1111-1111-111111111111' }, error: null }) }) }) }) } as any,
    lineupCache,
    gameStateStore,
    realtimeSubscriber: new InMemoryRealtimeBus(),
  });
  await fastify.register(sessionRoutes);

  const response = await fastify.inject({
    method: 'PUT',
    url: '/session/primary',
    headers: { authorization: `Bearer ${token}` },
    payload: { game_id: '11111111-1111-1111-1111-111111111111', source: 'deeplink' },
  });
  await fastify.close();
  expect(`${response.statusCode} ${response.body}`).toBe('sentinel');
});
