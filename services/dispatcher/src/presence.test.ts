import { describe, expect, it } from 'vitest';
import {
  decodeConnectionMember,
  encodeConnectionMember,
  listLivePresenceConnections,
  presenceKey,
  writePresenceConnection,
} from './presence.js';
import { MemoryPresenceRedis } from './presenceRedisMemory.js';

const connection = {
  userId: 'user-1',
  deviceId: '11111111-1111-4111-8111-111111111111',
  connectionId: 'conn-1',
  platform: 'web' as const,
  visibility: 'visible' as const,
};

describe('presence members', () => {
  it('encodes a connection without visibility or user id', () => {
    expect(encodeConnectionMember(connection)).toBe(`${connection.deviceId}|conn-1|web`);
    expect(decodeConnectionMember(encodeConnectionMember(connection))).toEqual({
      deviceId: connection.deviceId,
      connectionId: 'conn-1',
      platform: 'web',
    });
  });

  it('lists live connections from that user\'s key only', async () => {
    const redis = new MemoryPresenceRedis();
    await writePresenceConnection(redis, { ...connection, userId: 'user-b', connectionId: 'other' }, 60_000);
    redis.commands.length = 0;

    expect(await listLivePresenceConnections(redis, 'user-a')).toEqual([]);
    expect(redis.commands).toEqual([`zrange ${presenceKey('user-a')}`]);
  });
});
