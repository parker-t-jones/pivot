import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import healthRoutes from './health.js';

const VAPID_NAMES = [
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
  'ANTHROPIC_API_KEY',
] as const;

describe('GET /health', () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const name of VAPID_NAMES) {
      saved.set(name, process.env[name]);
      Reflect.deleteProperty(process.env, name);
    }
  });

  afterEach(async () => {
    delete process.env['GIT_SHA'];
    for (const name of VAPID_NAMES) {
      const previous = saved.get(name);
      if (previous === undefined) Reflect.deleteProperty(process.env, name);
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
    expect(response.json()).toEqual({
      ok: true,
      version: 'dev',
      webPush: 'disabled',
      slipImport: 'disabled',
    });
  });

  it('returns GIT_SHA as version when set', async () => {
    process.env['GIT_SHA'] = 'abc1234';
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      version: 'abc1234',
      webPush: 'disabled',
      slipImport: 'disabled',
    });
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

  it('reports slipImport enabled only when ANTHROPIC_API_KEY is set, without exposing it', async () => {
    process.env['ANTHROPIC_API_KEY'] = '   ';
    const blank = await buildApp();
    expect((await blank.inject({ method: 'GET', url: '/health' })).json()).toMatchObject({
      slipImport: 'disabled',
    });

    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-value';
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.json()).toMatchObject({ slipImport: 'enabled' });
    expect(response.body).not.toContain('sk-ant-test-value');
  });

  it('does not require Authorization', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });
});
