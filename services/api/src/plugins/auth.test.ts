import Fastify from 'fastify';
import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';
import authPlugin from './auth.js';

const JWT_SECRET = 'test-secret-at-least-32-characters-long';

async function signToken(payload: Record<string, unknown>): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function buildApp() {
  const app = Fastify();
  await app.register(authPlugin, {
    jwtSecret: JWT_SECRET,
    supabaseUrl: 'http://127.0.0.1:54321',
  });
  app.get('/protected', { preHandler: app.authenticate }, async (request) => ({
    userId: request.user?.id,
  }));
  return app;
}

describe('auth plugin', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = await buildApp();
  });

  it('rejects requests with no Authorization header', async () => {
    const response = await app.inject({ method: 'GET', url: '/protected' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: 'unauthorized', message: 'Missing Authorization bearer token.' },
    });
  });

  it('rejects malformed bearer tokens', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer not-a-real-jwt' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects tokens signed with the wrong secret', async () => {
    const badToken = await new SignJWT({ sub: 'user-1', email: 'a@b.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode('wrong-secret-that-is-also-long-enough'));

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${badToken}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a valid signature missing sub/email claims', async () => {
    const token = await signToken({ role: 'authenticated' });
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('attaches request.user for a valid token', async () => {
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ userId: 'user-1' });
  });
});
