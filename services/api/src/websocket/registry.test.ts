import { describe, expect, it } from 'vitest';
import { RealtimeConnection, type SendableSocket } from './connection.js';
import { ConnectionRegistry } from './registry.js';

function fakeSocket(): SendableSocket {
  return {
    send: () => {
      // Registry tests only care about connection bookkeeping, not what's sent.
    },
    close: () => {
      // Registry tests only care about connection bookkeeping, not close semantics.
    },
  };
}

describe('ConnectionRegistry', () => {
  it('returns all connections for a user, supporting multiple devices', () => {
    const registry = new ConnectionRegistry();
    const a = new RealtimeConnection(fakeSocket(), 'user-1', 0);
    const b = new RealtimeConnection(fakeSocket(), 'user-1', 0);
    const c = new RealtimeConnection(fakeSocket(), 'user-2', 0);
    registry.add(a);
    registry.add(b);
    registry.add(c);

    const forUser1 = registry.forUser('user-1');
    expect(forUser1).toHaveLength(2);
    expect(forUser1.map((conn) => conn.id).sort()).toEqual([a.id, b.id].sort());
    expect(registry.forUser('user-2')).toEqual([c]);
    expect(registry.size()).toBe(3);
  });

  it('removes a connection and drops the user bucket once empty', () => {
    const registry = new ConnectionRegistry();
    const a = new RealtimeConnection(fakeSocket(), 'user-1', 0);
    registry.add(a);
    expect(registry.hasConnection('user-1')).toBe(true);

    registry.remove(a.id);
    expect(registry.hasConnection('user-1')).toBe(false);
    expect(registry.forUser('user-1')).toEqual([]);
    expect(registry.size()).toBe(0);
  });

  it('removing an unknown connection id is a no-op', () => {
    const registry = new ConnectionRegistry();
    expect(() => registry.remove('does-not-exist')).not.toThrow();
  });

  it('forGame filters by each connection subscribedGameIds set', () => {
    const registry = new ConnectionRegistry();
    const a = new RealtimeConnection(fakeSocket(), 'user-1', 0);
    const b = new RealtimeConnection(fakeSocket(), 'user-2', 0);
    a.subscribedGameIds.add('game-1');
    registry.add(a);
    registry.add(b);

    expect(registry.forGame('game-1')).toEqual([a]);
    expect(registry.forGame('game-2')).toEqual([]);
  });

  it('all returns every registered connection', () => {
    const registry = new ConnectionRegistry();
    const a = new RealtimeConnection(fakeSocket(), 'user-1', 0);
    const b = new RealtimeConnection(fakeSocket(), 'user-2', 0);
    registry.add(a);
    registry.add(b);
    expect(registry.all().map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
  });
});
