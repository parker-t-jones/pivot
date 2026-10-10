import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_WEB_ORIGIN, registerWebCors } from './cors.js';

const LOCAL_ORIGIN = 'http://127.0.0.1:8081';

async function app(webDevOrigin?: string) {
  const fastify = Fastify();
  await registerWebCors(fastify, webDevOrigin);
  fastify.get('/health', async () => ({ ok: true }));
  return fastify;
}

function preflight(origin: string) {
  return {
    method: 'OPTIONS' as const,
    url: '/health',
    headers: {
      origin,
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization,content-type',
    },
  };
}

describe('web CORS', () => {
  it('answers the production origin preflight and allows Authorization', async () => {
    const fastify = await app(LOCAL_ORIGIN);
    const response = await fastify.inject(preflight(PRODUCTION_WEB_ORIGIN));
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(PRODUCTION_WEB_ORIGIN);
    expect(String(response.headers['access-control-allow-headers']).toLowerCase()).toContain(
      'authorization',
    );
    expect(String(response.headers['access-control-allow-methods'])).toContain('PATCH');
    await fastify.close();
  });

  it('allows the local origin only when WEB_DEV_ORIGIN is set', async () => {
    const closed = await app();
    const denied = await closed.inject(preflight(LOCAL_ORIGIN));
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    await closed.close();

    const open = await app(LOCAL_ORIGIN);
    const allowed = await open.inject(preflight(LOCAL_ORIGIN));
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(LOCAL_ORIGIN);
    await open.close();
  });

  it('does not add CORS headers when the request has no Origin', async () => {
    const fastify = await app(LOCAL_ORIGIN);
    const response = await fastify.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    await fastify.close();
  });
});
