import { ACTIVE_USER_TTL_MS, type PresenceVisibility } from '@pivot/dispatcher';
import type { FastifyPluginAsync } from 'fastify';
import { ApiError, toErrorBody } from '../lib/errors.js';
import { requireUser } from '../plugins/auth.js';
import '../plugins/services.js';
import { RealtimeConnection } from '../websocket/connection.js';
import { buildEnvelope, parseClientMessage } from '../websocket/messages.js';
import { ConnectionRegistry } from '../websocket/registry.js';
import { resolveRealtimeIdentity } from './realtimeIdentity.js';

type TrackedPresence =
  | { kind: 'legacy' }
  | { kind: 'device'; deviceId: string; platform: 'ios' | 'web'; visibility: PresenceVisibility };

/** Section 9: "Client ping every 25s; client reconnects if no pong within 10s" on the client side —
 *  the server-side mirror is "closes connections that haven't sent ping in 40s". */
const DEFAULT_PING_TIMEOUT_MS = 40_000;
/** How often the idle sweep runs. Well under the ping timeout so a stale connection isn't kept open
 *  much longer than the timeout implies. */
const DEFAULT_SWEEP_INTERVAL_MS = 5_000;

export interface RealtimeRoutesOptions {
  /** Overridable only so tests can exercise the idle-close sweep without a 40s real-time wait. */
  pingTimeoutMs?: number;
  sweepIntervalMs?: number;
}

function extractToken(query: unknown): string | null {
  if (typeof query !== 'object' || query === null) return null;
  const token = (query as Record<string, unknown>)['token'];
  return typeof token === 'string' && token.length > 0 ? token : null;
}

function rawMessageToText(raw: Buffer | ArrayBuffer | Buffer[]): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
  return raw.toString('utf8');
}

/**
 * `GET /v1/realtime` (Section 9 WebSocket protocol). Auth happens in a `preValidation` hook — i.e.
 * before `@fastify/websocket` upgrades the connection — so an invalid/missing token gets a clean
 * HTTP 401 with no socket ever created (no zombie connections). See `@fastify/websocket`'s docs:
 * hooks up to and including `preValidation` run before the upgrade for `{ websocket: true }` routes.
 */
const realtimeRoutes: FastifyPluginAsync<RealtimeRoutesOptions> = async (fastify, options) => {
  const pingTimeoutMs = options.pingTimeoutMs ?? DEFAULT_PING_TIMEOUT_MS;
  const sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const registry = new ConnectionRegistry();

  // Process-wide pattern subscriptions (Phase 4 fan-out design) — one `psubscribe` per channel
  // family (matching `realtimeUserChannel`/`realtimeGameChannel`'s `realtime:{user,game}:{id}` shape
  // from the dispatcher), not one per connection. Every message this process receives from Redis is
  // relayed to whichever LOCAL connections match; other API instances relay to their own local
  // connections.
  const userSubscription = await fastify.realtimeSubscriber.psubscribe(
    'realtime:user:*',
    (channel, message) => {
      const userId = channel.slice('realtime:user:'.length);
      for (const connection of registry.forUser(userId)) connection.send(message);
    },
  );
  const gameSubscription = await fastify.realtimeSubscriber.psubscribe(
    'realtime:game:*',
    (channel, message) => {
      const gameId = channel.slice('realtime:game:'.length);
      for (const connection of registry.forGame(gameId)) connection.send(message);
    },
  );

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const connection of registry.all()) {
      if (connection.isStale(now, pingTimeoutMs)) {
        connection.close(1000, 'ping timeout');
      }
    }
  }, sweepIntervalMs);

  fastify.addHook('onClose', async () => {
    clearInterval(sweep);
    await userSubscription.unsubscribe();
    await gameSubscription.unsubscribe();
  });

  await fastify.register(async (scoped) => {
    scoped.addHook('preValidation', async (request, reply) => {
      const token = extractToken(request.query);
      if (!token) {
        const error = new ApiError(401, 'unauthorized', 'Missing token query parameter.');
        await reply.status(error.statusCode).send(toErrorBody(error));
        return;
      }
      try {
        request.user = await fastify.verifyAuthToken(token);
      } catch {
        const error = new ApiError(401, 'unauthorized', 'Invalid or expired token.');
        await reply.status(error.statusCode).send(toErrorBody(error));
        return;
      }
      const identity = resolveRealtimeIdentity(request.query);
      if (identity.kind === 'reject') {
        const error = new ApiError(400, 'invalid_device', identity.message);
        await reply.status(error.statusCode).send(toErrorBody(error));
      }
    });

    scoped.get('/v1/realtime', { websocket: true }, (socket, request) => {
      const user = requireUser(request);
      const identity = resolveRealtimeIdentity(request.query);
      if (identity.kind === 'reject') {
        socket.close(1008, 'invalid device');
        return;
      }
      const connection = new RealtimeConnection(socket, user.id, Date.now());
      registry.add(connection);
      const tracked: TrackedPresence =
        identity.kind === 'legacy'
          ? { kind: 'legacy' }
          : { kind: 'device', deviceId: identity.deviceId, platform: identity.platform, visibility: 'visible' };

      let disposed = false;
      let presenceChain = Promise.resolve();
      const enqueuePresence = (kind: 'refresh' | 'remove', operation: () => Promise<void>): void => {
        presenceChain = presenceChain
          .then(async () => {
            if (kind === 'refresh' && disposed) return;
            if (kind === 'remove') disposed = true;
            await operation();
          })
          .catch((error: unknown) => request.log.error(error, 'presence update failed'));
      };
      const refreshPresence = (): Promise<void> => {
        if (tracked.kind === 'legacy') {
          return fastify.gameStateStore.markUserActive(user.id, ACTIVE_USER_TTL_MS);
        }
        return fastify.gameStateStore.markConnectionActive(
          {
            userId: user.id,
            deviceId: tracked.deviceId,
            connectionId: connection.id,
            platform: tracked.platform,
            visibility: tracked.visibility,
          },
          ACTIVE_USER_TTL_MS,
        );
      };

      enqueuePresence('refresh', refreshPresence);

      socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
        const intent = parseClientMessage(rawMessageToText(raw));
        switch (intent.kind) {
          case 'pong': {
            const now = Date.now();
            connection.touchPing(now);
            enqueuePresence('refresh', refreshPresence);
            connection.send(buildEnvelope('pong', {}, now));
            break;
          }
          case 'subscribe_game':
            connection.subscribedGameIds.add(intent.gameId);
            break;
          case 'unsubscribe_game':
            connection.subscribedGameIds.delete(intent.gameId);
            break;
          case 'visibility':
            if (tracked.kind === 'device' && tracked.platform === 'web') {
              tracked.visibility = intent.state;
              enqueuePresence('refresh', refreshPresence);
            }
            break;
          case 'error':
            connection.send(buildEnvelope('error', { code: intent.code, message: intent.message }));
            break;
        }
      });

      // Fires for both graceful (`close()`) and abrupt (network drop, terminated process) client
      // disconnects. A legacy socket removes only the bare user-id member. A device socket
      // removes only this connection.
      socket.on('close', () => {
        registry.remove(connection.id);
        enqueuePresence('remove', () =>
          tracked.kind === 'legacy'
            ? fastify.gameStateStore.removeActiveUser(user.id)
            : fastify.gameStateStore.removeConnection(user.id, connection.id),
        );
      });
    });
  });
};

export default realtimeRoutes;
