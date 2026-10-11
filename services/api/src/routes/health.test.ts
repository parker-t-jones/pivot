import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import healthRoutes from './health.js';

const VAPID_NAMES = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const;

describe('GET /health', () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const name of VAPID_NAMES) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
  });

  afterEach(async () => {
    delete process.env['GIT_SHA'];
    for (const name of VAPID_NAMES) {
      const previous = saved.get(name);
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
    saved.clear();
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
    expect(response.json()).toEqual({ ok: true, version: 'dev', webPush: 'disabled' });
  });

  it('returns GIT_SHA as version when set', async () => {
    process.env['GIT_SHA'] = 'abc1234';
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, version: 'abc1234', webPush: 'disabled' });
  });

  it('reports webPush enabled only when all three VAPID variables are set', async () => {
    process.env['VAPID_PUBLIC_KEY'] = 'public';
    process.env['VAPID_PRIVATE_KEY'] = 'private';
    process.env['VAPID_SUBJECT'] = 'mailto:support@pivot-sports.app';
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ webPush: 'enabled' });
  });

  it('does not require Authorization', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });
});
