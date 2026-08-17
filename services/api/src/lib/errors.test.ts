import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError, apiErrorHandler } from './errors.js';

describe('apiErrorHandler', () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function buildApp() {
    const app = Fastify({ logger: false });
    app.setErrorHandler(apiErrorHandler);
    app.delete('/no-body', async (_request, reply) => reply.status(204).send());
    app.get('/boom', async () => {
      throw new Error('unexpected');
    });
    app.get('/api-error', async () => {
      throw new ApiError(404, 'not_found', 'Missing.');
    });
    apps.push(app);
    await app.ready();
    return app;
  }

  it('honors FastifyError statusCode for empty JSON body (does not flatten to 500)', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'DELETE',
      url: '/no-body',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: 'FST_ERR_CTP_EMPTY_JSON_BODY',
        message: "Body cannot be empty when content-type is set to 'application/json'",
      },
    });
  });

  it('still returns opaque 500 for unexpected errors without statusCode', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: 'internal_error', message: 'Internal server error.' },
    });
  });

  it('still returns ApiError statusCode and body', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api-error' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'not_found', message: 'Missing.' },
    });
  });
});
