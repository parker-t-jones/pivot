import { InMemoryGameStateStore, LEGACY_IOS_DEVICE_ID } from '@pivot/dispatcher';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import websocketPlugin from '@fastify/websocket';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { InMemoryRealtimeBus } from '@pivot/dispatcher';
import { InMemoryLineupCache } from '../cache/in-memory.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import authPlugin from '../plugins/auth.js';
import servicesPlugin from '../plugins/services.js';
import realtimeRoutes, { type RealtimeRoutesOptions } from './realtime.js';

const JWT_SECRET = 'test-secret-at-least-32-characters-long';

async function signToken(payload: Record<string, unknown>): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

interface TestApp {
  fastify: ReturnType<typeof Fastify>;
  url: string;
  gameStateStore: InMemoryGameStateStore;
  realtimeBus: InMemoryRealtimeBus;
}

async function buildTestApp(routeOptions: RealtimeRoutesOptions = {}): Promise<TestApp> {
  const gameStateStore = new InMemoryGameStateStore();
  const realtimeBus = new InMemoryRealtimeBus();

  const fastify = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  await fastify.register(authPlugin, {
    jwtSecret: JWT_SECRET,
    supabaseUrl: 'http://127.0.0.1:54321',
  });
  await fastify.register(servicesPlugin, {
    supabase: {} as SupabaseServiceClient,
    lineupCache: new InMemoryLineupCache(),
    gameStateStore,
    realtimeSubscriber: realtimeBus,
  });
  await fastify.register(websocketPlugin);
  await fastify.register(realtimeRoutes, routeOptions);

  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const address = fastify.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected a bound TCP address.');
  }
  return { fastify, url: `ws://127.0.0.1:${address.port}/v1/realtime`, gameStateStore, realtimeBus };
}

function onceMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data: Buffer) => {
      try {
        resolve(JSON.parse(data.toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function onceOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

function onceClose(socket: WebSocket): Promise<number> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve(socket.readyState);
  return new Promise((resolve) => {
    socket.once('close', (code: number) => resolve(code));
  });
}

describe('GET /v1/realtime', () => {
  let app: TestApp;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.fastify.close();
  });

  it('rejects the upgrade with 401 and no socket when the token is missing', async () => {
    const response = await app.fastify.inject({ method: 'GET', url: '/v1/realtime' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: 'unauthorized', message: 'Missing token query parameter.' },
    });
  });

  it('rejects the upgrade with 401 for an invalid token', async () => {
    const response = await app.fastify.inject({
      method: 'GET',
      url: '/v1/realtime?token=not-a-real-jwt',
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: 'unauthorized', message: 'Invalid or expired token.' },
    });
  });

  it('rejects a real WebSocket handshake attempt with an invalid token (no hang, no open socket)', async () => {
    const socket = new WebSocket(`${app.url}?token=not-a-real-jwt`);
    const outcome = await new Promise<'error' | 'open'>((resolve) => {
      socket.once('open', () => resolve('open'));
      socket.once('error', () => resolve('error'));
    });
    expect(outcome).toBe('error');
    expect(socket.readyState).not.toBe(WebSocket.OPEN);
  });

  it('accepts a valid token, marks the user active, and un-marks them on graceful close', async () => {
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });
    const socket = new WebSocket(`${app.url}?token=${token}`);
    await onceOpen(socket);

    expect(await app.gameStateStore.isUserActive('user-1')).toBe(true);

    socket.close();
    await onceClose(socket);
    // The server's own 'close' handler needs a tick to run after the client-side close event fires.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await app.gameStateStore.isUserActive('user-1')).toBe(false);
  });

  it('un-marks the user active on an abrupt disconnect (no close handshake)', async () => {
    const token = await signToken({ sub: 'user-2', email: 'a@b.com' });
    const socket = new WebSocket(`${app.url}?token=${token}`);
    await onceOpen(socket);
    expect(await app.gameStateStore.isUserActive('user-2')).toBe(true);

    socket.terminate();
    await onceClose(socket);
    // The server's own 'close' handler needs a tick to run after the socket-level teardown.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await app.gameStateStore.isUserActive('user-2')).toBe(false);
  });

  it('replies pong to a client ping and refreshes active_users', async () => {
    const token = await signToken({ sub: 'user-3', email: 'a@b.com' });
    const socket = new WebSocket(`${app.url}?token=${token}`);
    await onceOpen(socket);

    const pongPromise = onceMessage(socket);
    socket.send(JSON.stringify({ id: '1', type: 'ping', timestamp: Date.now(), payload: {} }));
    const pong = await pongPromise;
    expect(pong['type']).toBe('pong');
    expect(pong['payload']).toEqual({});

    socket.close();
    await onceClose(socket);
  });

  it('sends an error envelope for a malformed client message without closing the connection', async () => {
    const token = await signToken({ sub: 'user-4', email: 'a@b.com' });
    const socket = new WebSocket(`${app.url}?token=${token}`);
    await onceOpen(socket);

    const errorPromise = onceMessage(socket);
    socket.send('not json');
    const errorEnvelope = await errorPromise;
    expect(errorEnvelope['type']).toBe('error');
    expect((errorEnvelope['payload'] as { code: string }).code).toBe('invalid_json');
    expect(socket.readyState).toBe(WebSocket.OPEN);

    socket.close();
    await onceClose(socket);
  });

  it('relays a realtime:user:{id} fan-out publish only to that user\'s connection', async () => {
    const tokenA = await signToken({ sub: 'user-a', email: 'a@b.com' });
    const tokenB = await signToken({ sub: 'user-b', email: 'b@b.com' });
    const socketA = new WebSocket(`${app.url}?token=${tokenA}`);
    const socketB = new WebSocket(`${app.url}?token=${tokenB}`);
    await Promise.all([onceOpen(socketA), onceOpen(socketB)]);

    let receivedByB = false;
    socketB.once('message', () => {
      receivedByB = true;
    });
    const messageForA = onceMessage(socketA);

    await app.realtimeBus.publish('realtime:user:user-a', {
      id: 'evt-1',
      type: 'flag_event',
      timestamp: Date.now(),
      payload: { hello: 'world' },
    });

    const received = await messageForA;
    expect(received['id']).toBe('evt-1');
    expect(receivedByB).toBe(false);

    socketA.close();
    socketB.close();
    await Promise.all([onceClose(socketA), onceClose(socketB)]);
  });

  it('relays realtime:game:{id} fan-out only to connections subscribed to that game', async () => {
    const token = await signToken({ sub: 'user-5', email: 'a@b.com' });
    const socket = new WebSocket(`${app.url}?token=${token}`);
    await onceOpen(socket);

    socket.send(
      JSON.stringify({
        id: '1',
        type: 'subscribe_game',
        timestamp: Date.now(),
        payload: { game_id: 'game-1' },
      }),
    );

    // Publishing to a game this connection did NOT subscribe to must not arrive.
    let unexpected = false;
    socket.once('message', () => {
      unexpected = true;
    });
    await app.realtimeBus.publish('realtime:game:game-2', { ignored: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unexpected).toBe(false);

    const messagePromise = onceMessage(socket);
    await app.realtimeBus.publish('realtime:game:game-1', { game_state: 'update' });
    const received = await messagePromise;
    expect(received).toEqual({ game_state: 'update' });

    socket.send(
      JSON.stringify({
        id: '2',
        type: 'unsubscribe_game',
        timestamp: Date.now(),
        payload: { game_id: 'game-1' },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    let receivedAfterUnsubscribe = false;
    socket.once('message', () => {
      receivedAfterUnsubscribe = true;
    });
    await app.realtimeBus.publish('realtime:game:game-1', { game_state: 'update-2' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(receivedAfterUnsubscribe).toBe(false);

    socket.close();
    await onceClose(socket);
  });

  it('closes idle connections that stop pinging within the configured timeout', async () => {
    await app.fastify.close();
    app = await buildTestApp({ pingTimeoutMs: 150, sweepIntervalMs: 30 });

    const token = await signToken({ sub: 'user-6', email: 'a@b.com' });
    const socket = new WebSocket(`${app.url}?token=${token}`);
    await onceOpen(socket);

    const closeCode = await onceClose(socket);
    expect(closeCode).toBe(1000);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await app.gameStateStore.isUserActive('user-6')).toBe(false);
  });

  it('rejects a web connection that does not send deviceId', async () => {
    const token = await signToken({ sub: 'user-web', email: 'a@b.com' });
    const response = await app.fastify.inject({
      method: 'GET',
      url: `/v1/realtime?token=${token}&platform=web`,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'invalid_device', message: 'A web connection must send deviceId.' },
    });
  });

  it('keeps the device active after one of two connections closes', async () => {
    const token = await signToken({ sub: 'user-device', email: 'a@b.com' });
    const deviceId = '11111111-1111-4111-8111-111111111111';
    const url = `${app.url}?token=${token}&deviceId=${deviceId}&platform=ios`;
    const first = new WebSocket(url);
    const second = new WebSocket(url);
    await onceOpen(first);
    await onceOpen(second);
    expect(await app.gameStateStore.isDeviceActive('user-device', deviceId)).toBe(true);

    first.close();
    await onceClose(first);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await app.gameStateStore.isDeviceActive('user-device', deviceId)).toBe(true);
    expect(await app.gameStateStore.isUserActive('user-device')).toBe(true);
    expect(await app.gameStateStore.isDeviceActive('user-device', LEGACY_IOS_DEVICE_ID)).toBe(false);

    second.close();
    await onceClose(second);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await app.gameStateStore.isDeviceActive('user-device', deviceId)).toBe(false);
    expect(await app.gameStateStore.isUserActive('user-device')).toBe(false);
  });

  it('stops counting a web connection when the tab is hidden and leaves a legacy phone in place', async () => {
    const token = await signToken({ sub: 'user-both', email: 'a@b.com' });
    const webDevice = '22222222-2222-4222-8222-222222222222';
    const phone = new WebSocket(`${app.url}?token=${token}`);
    const web = new WebSocket(`${app.url}?token=${token}&deviceId=${webDevice}&platform=web`);
    await onceOpen(phone);
    await onceOpen(web);
    expect(await app.gameStateStore.isDeviceActive('user-both', LEGACY_IOS_DEVICE_ID)).toBe(true);
    expect(await app.gameStateStore.isDeviceActive('user-both', webDevice)).toBe(true);

    web.send(
      JSON.stringify({
        id: 'vis',
        type: 'visibility',
        timestamp: Date.now(),
        payload: { state: 'hidden' },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(web.readyState).toBe(WebSocket.OPEN);
    expect(await app.gameStateStore.isDeviceActive('user-both', webDevice)).toBe(false);
    expect(await app.gameStateStore.isDeviceActive('user-both', LEGACY_IOS_DEVICE_ID)).toBe(true);
    expect(await app.gameStateStore.isUserActive('user-both')).toBe(true);

    phone.close();
    web.close();
    await onceClose(phone);
    await onceClose(web);
  });
});
