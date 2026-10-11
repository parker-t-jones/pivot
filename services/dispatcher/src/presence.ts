/**
 * Presence keys.
 *
 * Legacy TestFlight clients still use one bare user-id member in `active_users`,
 * scored by expiry (`now + ttlMs`). That path is unchanged.
 *
 * A current client writes `presence:{userId}`, a sorted set whose member is
 * `{deviceId}|{connectionId}|{platform}` and whose score is the same expiry.
 * Every write prunes that key with `ZREMRANGEBYSCORE 0 now-1`, then writes, then
 * `PEXPIRE`s the key to the TTL. Lookups read only that user's key.
 *
 * Visibility is not part of the member. It lives in the hash `presence-vis:{userId}`,
 * field `{connectionId}`, value `visible` or `hidden`. The hash is written before the
 * sorted-set member, so a crash cannot leave a second "visible" member behind. A
 * missing field counts as visible (iOS never hides). A hidden web connection does
 * not count. The hash gets the same `PEXPIRE`, and fields for pruned connections
 * are removed on the next write.
 */

export const LEGACY_IOS_DEVICE_ID = 'legacy-ios';

export type PresencePlatform = 'ios' | 'web';
export type PresenceVisibility = 'visible' | 'hidden';

export interface PresenceConnection {
  userId: string;
  deviceId: string;
  connectionId: string;
  platform: PresencePlatform;
  visibility: PresenceVisibility;
}

const DEVICE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isDeviceId(value: string): boolean {
  return DEVICE_ID_PATTERN.test(value);
}

export function presenceKey(userId: string): string {
  return `presence:${userId}`;
}

export function presenceVisibilityKey(userId: string): string {
  return `presence-vis:${userId}`;
}

export function connectionCountsAsActive(connection: PresenceConnection): boolean {
  return !(connection.platform === 'web' && connection.visibility === 'hidden');
}

export function encodeConnectionMember(
  connection: Pick<PresenceConnection, 'deviceId' | 'connectionId' | 'platform'>,
): string {
  return `${connection.deviceId}|${connection.connectionId}|${connection.platform}`;
}

export function decodeConnectionMember(
  member: string,
): Pick<PresenceConnection, 'deviceId' | 'connectionId' | 'platform'> | null {
  const parts = member.split('|');
  if (parts.length !== 3) return null;
  const [deviceId, connectionId, platform] = parts;
  if (!deviceId || !connectionId) return null;
  if (platform !== 'ios' && platform !== 'web') return null;
  return { deviceId, connectionId, platform };
}

export interface PresenceRedis {
  zrangeByScore(key: string, min: number, max: number): Promise<string[]>;
  zremRangeByScore(key: string, min: number, max: number): Promise<void>;
  zadd(key: string, score: number, member: string): Promise<void>;
  zrem(key: string, members: string[]): Promise<void>;
  hgetAll(key: string): Promise<Record<string, string>>;
  hset(key: string, field: string, value: string): Promise<void>;
  hdel(key: string, fields: string[]): Promise<void>;
  pexpire(key: string, ttlMs: number): Promise<void>;
  del(keys: string[]): Promise<void>;
}

const LIVE_MAX = Number.POSITIVE_INFINITY;

function visibilityOf(
  raw: string | undefined,
): PresenceVisibility {
  return raw === 'hidden' ? 'hidden' : 'visible';
}

/**
 * Prune expired members, commit visibility, refresh this connection's score, then
 * set the key TTL. Visibility is written before the sorted-set add.
 */
export async function writePresenceConnection(
  redis: PresenceRedis,
  connection: PresenceConnection,
  ttlMs: number,
  now = Date.now(),
): Promise<void> {
  const connectionsKey = presenceKey(connection.userId);
  const visibilityKey = presenceVisibilityKey(connection.userId);
  const expired = await redis.zrangeByScore(connectionsKey, 0, now - 1);
  await redis.zremRangeByScore(connectionsKey, 0, now - 1);
  await redis.hset(visibilityKey, connection.connectionId, connection.visibility);
  await redis.zadd(connectionsKey, now + ttlMs, encodeConnectionMember(connection));
  const expiredIds = expired
    .map((member) => decodeConnectionMember(member)?.connectionId)
    .filter((id): id is string => id !== undefined && id !== connection.connectionId);
  if (expiredIds.length > 0) await redis.hdel(visibilityKey, expiredIds);
  await redis.pexpire(connectionsKey, ttlMs);
  await redis.pexpire(visibilityKey, ttlMs);
}

export async function removePresenceConnection(
  redis: PresenceRedis,
  userId: string,
  connectionId: string,
  now = Date.now(),
): Promise<void> {
  const connectionsKey = presenceKey(userId);
  const visibilityKey = presenceVisibilityKey(userId);
  const expired = await redis.zrangeByScore(connectionsKey, 0, now - 1);
  await redis.zremRangeByScore(connectionsKey, 0, now - 1);
  const live = await redis.zrangeByScore(connectionsKey, now, LIVE_MAX);
  const mine = live.filter((member) => decodeConnectionMember(member)?.connectionId === connectionId);
  if (mine.length > 0) await redis.zrem(connectionsKey, mine);
  const dropIds = [
    connectionId,
    ...expired
      .map((member) => decodeConnectionMember(member)?.connectionId)
      .filter((id): id is string => id !== undefined),
  ];
  await redis.hdel(visibilityKey, dropIds);
  const remaining = await redis.zrangeByScore(connectionsKey, now, LIVE_MAX);
  if (remaining.length === 0) {
    await redis.del([connectionsKey, visibilityKey]);
    return;
  }
}

/** Live connections for this user only. An idle key that has expired yields nothing. */
export async function listLivePresenceConnections(
  redis: PresenceRedis,
  userId: string,
  now = Date.now(),
): Promise<PresenceConnection[]> {
  const members = await redis.zrangeByScore(presenceKey(userId), now, LIVE_MAX);
  if (members.length === 0) return [];
  const visibility = await redis.hgetAll(presenceVisibilityKey(userId));
  const connections: PresenceConnection[] = [];
  for (const member of members) {
    const decoded = decodeConnectionMember(member);
    if (!decoded) continue;
    connections.push({
      userId,
      ...decoded,
      visibility: visibilityOf(visibility[decoded.connectionId]),
    });
  }
  return connections;
}
