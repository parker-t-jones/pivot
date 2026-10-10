/**
 * `active_users` members.
 *
 * A bare user id is the current TestFlight client: `markUserActive(userId)` /
 * `removeActiveUser(userId)`. That member is device `legacy-ios`.
 *
 * A connection member is `c|{userId}|{deviceId}|{connectionId}|{platform}|{visibility}`.
 * The score on both kinds is still an expiry timestamp (`now + ttlMs`). A member is
 * live while `score >= now`.
 *
 * A hidden web connection stays in the set until it expires or closes, and does not
 * count as active. iOS connections are always visible; backgrounding closes the socket.
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

export type DecodedPresenceMember =
  | { kind: 'legacy-user'; userId: string }
  | { kind: 'connection'; connection: PresenceConnection }
  | { kind: 'invalid' };

const DEVICE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isDeviceId(value: string): boolean {
  return DEVICE_ID_PATTERN.test(value);
}

export function connectionCountsAsActive(connection: PresenceConnection): boolean {
  return !(connection.platform === 'web' && connection.visibility === 'hidden');
}

export function encodePresenceMember(connection: PresenceConnection): string {
  return [
    'c',
    connection.userId,
    connection.deviceId,
    connection.connectionId,
    connection.platform,
    connection.visibility,
  ].join('|');
}

export function decodePresenceMember(member: string): DecodedPresenceMember {
  if (!member.startsWith('c|')) {
    return member.length > 0 ? { kind: 'legacy-user', userId: member } : { kind: 'invalid' };
  }
  const parts = member.split('|');
  if (parts.length !== 6) return { kind: 'invalid' };
  const platform = parts[4];
  const visibility = parts[5];
  if (platform !== 'ios' && platform !== 'web') return { kind: 'invalid' };
  if (visibility !== 'visible' && visibility !== 'hidden') return { kind: 'invalid' };
  const userId = parts[1];
  const deviceId = parts[2];
  const connectionId = parts[3];
  if (!userId || !deviceId || !connectionId) return { kind: 'invalid' };
  return {
    kind: 'connection',
    connection: { userId, deviceId, connectionId, platform, visibility },
  };
}

/** Unexpired members only. Hidden web connections are ignored. Legacy members count. */
export function activeUserIdsFromMembers(members: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const member of members) {
    const decoded = decodePresenceMember(member);
    if (decoded.kind === 'legacy-user') ids.add(decoded.userId);
    else if (decoded.kind === 'connection' && connectionCountsAsActive(decoded.connection)) {
      ids.add(decoded.connection.userId);
    }
  }
  return [...ids];
}

export function userHasCountingConnection(members: readonly string[], userId: string): boolean {
  for (const member of members) {
    const decoded = decodePresenceMember(member);
    if (
      decoded.kind === 'connection' &&
      decoded.connection.userId === userId &&
      connectionCountsAsActive(decoded.connection)
    ) {
      return true;
    }
  }
  return false;
}

export function deviceHasCountingConnection(
  members: readonly string[],
  userId: string,
  deviceId: string,
): boolean {
  for (const member of members) {
    const decoded = decodePresenceMember(member);
    if (
      decoded.kind === 'connection' &&
      decoded.connection.userId === userId &&
      decoded.connection.deviceId === deviceId &&
      connectionCountsAsActive(decoded.connection)
    ) {
      return true;
    }
  }
  return false;
}

export function membersForConnection(members: readonly string[], connectionId: string): string[] {
  const matches: string[] = [];
  for (const member of members) {
    const decoded = decodePresenceMember(member);
    if (decoded.kind === 'connection' && decoded.connection.connectionId === connectionId) {
      matches.push(member);
    }
  }
  return matches;
}
