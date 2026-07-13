import { describe, expect, it } from 'vitest';
import { RealtimeConnection, type SendableSocket } from './connection.js';

function fakeSocket(): SendableSocket & {
  sent: string[];
  closed: { code: number | undefined; reason: string | undefined }[];
} {
  const sent: string[] = [];
  const closed: { code: number | undefined; reason: string | undefined }[] = [];
  return {
    sent,
    closed,
    send: (data: string) => sent.push(data),
    close: (code?: number, reason?: string) => closed.push({ code, reason }),
  };
}

describe('RealtimeConnection', () => {
  it('assigns a unique id and exposes userId', () => {
    const a = new RealtimeConnection(fakeSocket(), 'user-1', 0);
    const b = new RealtimeConnection(fakeSocket(), 'user-1', 0);
    expect(a.id).not.toBe(b.id);
    expect(a.userId).toBe('user-1');
  });

  it('serializes sent messages to JSON over the socket', () => {
    const socket = fakeSocket();
    const connection = new RealtimeConnection(socket, 'user-1', 0);
    connection.send({ id: '1', type: 'pong', timestamp: 0, payload: {} });
    expect(socket.sent).toEqual([JSON.stringify({ id: '1', type: 'pong', timestamp: 0, payload: {} })]);
  });

  it('starts with an empty subscribedGameIds set', () => {
    const connection = new RealtimeConnection(fakeSocket(), 'user-1', 0);
    expect(connection.subscribedGameIds.size).toBe(0);
  });

  it('is not stale until timeoutMs has elapsed since the last ping', () => {
    const connection = new RealtimeConnection(fakeSocket(), 'user-1', 0);
    expect(connection.isStale(39_000, 40_000)).toBe(false);
    expect(connection.isStale(41_000, 40_000)).toBe(true);
  });

  it('touchPing resets the staleness clock', () => {
    const connection = new RealtimeConnection(fakeSocket(), 'user-1', 0);
    connection.touchPing(30_000);
    expect(connection.isStale(69_000, 40_000)).toBe(false);
    expect(connection.isStale(71_000, 40_000)).toBe(true);
  });

  it('close delegates to the socket', () => {
    const socket = fakeSocket();
    const connection = new RealtimeConnection(socket, 'user-1', 0);
    connection.close(1000, 'ping timeout');
    expect(socket.closed).toEqual([{ code: 1000, reason: 'ping timeout' }]);
  });
});
