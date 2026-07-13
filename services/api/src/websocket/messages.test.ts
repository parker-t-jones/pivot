import { describe, expect, it } from 'vitest';
import { buildEnvelope, parseClientMessage } from './messages.js';

describe('buildEnvelope', () => {
  it('builds the Section 9 envelope shape with a generated id', () => {
    const envelope = buildEnvelope('pong', {}, 1_700_000_000_000);
    expect(envelope.type).toBe('pong');
    expect(envelope.timestamp).toBe(1_700_000_000_000);
    expect(envelope.payload).toEqual({});
    expect(typeof envelope.id).toBe('string');
    expect(envelope.id.length).toBeGreaterThan(0);
  });
});

describe('parseClientMessage', () => {
  it('rejects non-JSON input', () => {
    expect(parseClientMessage('not json')).toEqual({
      kind: 'error',
      code: 'invalid_json',
      message: 'Message must be valid JSON.',
    });
  });

  it('rejects JSON that does not match the envelope shape', () => {
    expect(parseClientMessage(JSON.stringify({ foo: 'bar' }))).toEqual({
      kind: 'error',
      code: 'invalid_envelope',
      message: 'Message must match the `{ id, type, timestamp, payload }` envelope.',
    });
  });

  it('parses a ping into a pong intent', () => {
    const raw = JSON.stringify({ id: '1', type: 'ping', timestamp: Date.now(), payload: {} });
    expect(parseClientMessage(raw)).toEqual({ kind: 'pong' });
  });

  it('parses subscribe_game with a valid game_id', () => {
    const raw = JSON.stringify({
      id: '1',
      type: 'subscribe_game',
      timestamp: Date.now(),
      payload: { game_id: 'game-1' },
    });
    expect(parseClientMessage(raw)).toEqual({ kind: 'subscribe_game', gameId: 'game-1' });
  });

  it('rejects subscribe_game missing game_id', () => {
    const raw = JSON.stringify({ id: '1', type: 'subscribe_game', timestamp: Date.now(), payload: {} });
    expect(parseClientMessage(raw)).toEqual({
      kind: 'error',
      code: 'invalid_payload',
      message: 'subscribe_game requires game_id.',
    });
  });

  it('parses unsubscribe_game with a valid game_id', () => {
    const raw = JSON.stringify({
      id: '1',
      type: 'unsubscribe_game',
      timestamp: Date.now(),
      payload: { game_id: 'game-1' },
    });
    expect(parseClientMessage(raw)).toEqual({ kind: 'unsubscribe_game', gameId: 'game-1' });
  });

  it('rejects unsubscribe_game missing game_id', () => {
    const raw = JSON.stringify({
      id: '1',
      type: 'unsubscribe_game',
      timestamp: Date.now(),
      payload: {},
    });
    expect(parseClientMessage(raw)).toEqual({
      kind: 'error',
      code: 'invalid_payload',
      message: 'unsubscribe_game requires game_id.',
    });
  });

  it('rejects unknown message types', () => {
    const raw = JSON.stringify({ id: '1', type: 'mystery', timestamp: Date.now(), payload: {} });
    expect(parseClientMessage(raw)).toEqual({
      kind: 'error',
      code: 'unknown_type',
      message: 'Unknown message type: mystery',
    });
  });
});
