import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/** Section 9 "Message envelope (both directions)" — verbatim. */
export interface Envelope<T = unknown> {
  id: string;
  type: string;
  timestamp: number;
  payload: T;
}

export function buildEnvelope<T>(type: string, payload: T, now: number = Date.now()): Envelope<T> {
  return { id: randomUUID(), type, timestamp: now, payload };
}

const envelopeSchema = z.object({
  id: z.string(),
  type: z.string(),
  timestamp: z.number(),
  payload: z.unknown(),
});

const gamePayloadSchema = z.object({ game_id: z.string().min(1) });

/**
 * The result of interpreting a raw client message (Section 9 "Client → server": `ping`,
 * `subscribe_game`, `unsubscribe_game`). Kept as a pure parse -> intent function, separate from the
 * WebSocket route's I/O (Redis, `GameStateStore`, the socket itself), so the routing logic here is
 * unit-testable without a live connection.
 */
export type ClientIntent =
  | { kind: 'pong' }
  | { kind: 'subscribe_game'; gameId: string }
  | { kind: 'unsubscribe_game'; gameId: string }
  | { kind: 'error'; code: string; message: string };

export function parseClientMessage(raw: string): ClientIntent {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { kind: 'error', code: 'invalid_json', message: 'Message must be valid JSON.' };
  }

  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success) {
    return {
      kind: 'error',
      code: 'invalid_envelope',
      message: 'Message must match the `{ id, type, timestamp, payload }` envelope.',
    };
  }

  switch (envelope.data.type) {
    case 'ping':
      return { kind: 'pong' };
    case 'subscribe_game': {
      const payload = gamePayloadSchema.safeParse(envelope.data.payload);
      if (!payload.success) {
        return { kind: 'error', code: 'invalid_payload', message: 'subscribe_game requires game_id.' };
      }
      return { kind: 'subscribe_game', gameId: payload.data.game_id };
    }
    case 'unsubscribe_game': {
      const payload = gamePayloadSchema.safeParse(envelope.data.payload);
      if (!payload.success) {
        return {
          kind: 'error',
          code: 'invalid_payload',
          message: 'unsubscribe_game requires game_id.',
        };
      }
      return { kind: 'unsubscribe_game', gameId: payload.data.game_id };
    }
    default:
      return {
        kind: 'error',
        code: 'unknown_type',
        message: `Unknown message type: ${envelope.data.type}`,
      };
  }
}
