import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import healthRoutes from './health.js';

describe('GET /health', () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    delete process.env['GIT_SHA'];
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function buildApp() {
    const fastify = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
    fastify.setValidatorCompiler(validatorCompiler);
    fastify.setSerializerCompiler(serializerCompiler);
    await fastify.register(healthRoutes);
    apps.push(fastify);
    await fastify.ready();
    return fastify;
  }

  it('returns 200 { ok: true, version: "dev" } when GIT_SHA is unset', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, version: 'dev' });
  });

  it('returns GIT_SHA as version when set', async () => {
    process.env['GIT_SHA'] = 'abc1234';
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, version: 'abc1234' });
  });

  it('does not require Authorization', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });
});
