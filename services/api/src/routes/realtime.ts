import { ACTIVE_USER_TTL_MS } from '@fantasy-focus/dispatcher';
import type { FastifyPluginAsync } from 'fastify';
import { ApiError, toErrorBody } from '../lib/errors.js';
import { requireUser } from '../plugins/auth.js';
import '../plugins/services.js';
import { RealtimeConnection } from '../websocket/connection.js';
import { buildEnvelope, parseClientMessage } from '../websocket/messages.js';
import { ConnectionRegistry } from '../websocket/registry.js';

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
      }
    });

    scoped.get('/v1/realtime', { websocket: true }, (socket, request) => {
      const user = requireUser(request);
      const connection = new RealtimeConnection(socket, user.id, Date.now());
      registry.add(connection);

      fastify.gameStateStore
        .markUserActive(user.id, ACTIVE_USER_TTL_MS)
        .catch((error: unknown) => request.log.error(error, 'markUserActive failed on connect'));

      socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
        const intent = parseClientMessage(rawMessageToText(raw));
        switch (intent.kind) {
          case 'pong': {
            const now = Date.now();
            connection.touchPing(now);
            fastify.gameStateStore
              .markUserActive(user.id, ACTIVE_USER_TTL_MS)
              .catch((error: unknown) => request.log.error(error, 'markUserActive failed on ping'));
            connection.send(buildEnvelope('pong', {}, now));
            break;
          }
          case 'subscribe_game':
            connection.subscribedGameIds.add(intent.gameId);
            break;
          case 'unsubscribe_game':
            connection.subscribedGameIds.delete(intent.gameId);
            break;
          case 'error':
            connection.send(buildEnvelope('error', { code: intent.code, message: intent.message }));
            break;
        }
      });

      // Fires for both graceful (`close()`) and abrupt (network drop, terminated process) client
      // disconnects — the underlying TCP socket teardown always emits `close` (sprint instruction:
      // "the disconnect handler must still run to remove from active_users").
      socket.on('close', () => {
        registry.remove(connection.id);
        fastify.gameStateStore
          .removeActiveUser(user.id)
          .catch((error: unknown) => request.log.error(error, 'removeActiveUser failed on disconnect'));
      });
    });
  });
};

export default realtimeRoutes;
