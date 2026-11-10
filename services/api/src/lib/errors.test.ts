import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ApiError,
  apiErrorHandler,
  OwnAccountRowMissingError,
  rethrowIfOwnAccountRowMissing,
} from './errors.js';

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
    app.get('/own-account-missing', async () => {
      throw new OwnAccountRowMissingError();
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

  it('translates OwnAccountRowMissingError into a clean 401 account_not_found, not a 500', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/own-account-missing' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: 'account_not_found',
        message: "Your account isn't available anymore. Please sign in again.",
      },
    });
  });
});

describe('rethrowIfOwnAccountRowMissing', () => {
  it('throws OwnAccountRowMissingError for Postgrest\'s "0 rows" shape (PGRST116)', () => {
    expect(() =>
      rethrowIfOwnAccountRowMissing({
        code: 'PGRST116',
        message: 'JSON object requested, multiple (or no) rows returned',
      }),
    ).toThrow(OwnAccountRowMissingError);
  });

  it('does nothing for a different Postgrest error code', () => {
    expect(() =>
      rethrowIfOwnAccountRowMissing({ code: '23505', message: 'duplicate key' }),
    ).not.toThrow();
  });

  it('does nothing for a null error', () => {
    expect(() => rethrowIfOwnAccountRowMissing(null)).not.toThrow();
  });
});
