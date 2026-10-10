import { describe, expect, it } from 'vitest';
import {
  activeUserIdsFromMembers,
  decodePresenceMember,
  deviceHasCountingConnection,
  encodePresenceMember,
  membersForConnection,
} from './presence.js';

const connection = {
  userId: 'user-1',
  deviceId: '11111111-1111-4111-8111-111111111111',
  connectionId: 'conn-1',
  platform: 'web' as const,
  visibility: 'visible' as const,
};

describe('presence members', () => {
  it('round-trips a connection and leaves a bare user id as the legacy slot', () => {
    const member = encodePresenceMember(connection);
    expect(decodePresenceMember(member)).toEqual({ kind: 'connection', connection });
    expect(decodePresenceMember('user-1')).toEqual({ kind: 'legacy-user', userId: 'user-1' });
  });

  it('drops a hidden web connection from the active user list and keeps the legacy phone', () => {
    const hidden = encodePresenceMember({ ...connection, visibility: 'hidden' });
    const visible = encodePresenceMember({ ...connection, connectionId: 'conn-2', visibility: 'visible' });
    expect(activeUserIdsFromMembers(['user-1', hidden])).toEqual(['user-1']);
    expect(activeUserIdsFromMembers([hidden])).toEqual([]);
    expect(deviceHasCountingConnection([visible], 'user-1', connection.deviceId)).toBe(true);
    expect(deviceHasCountingConnection([hidden], 'user-1', connection.deviceId)).toBe(false);
    expect(membersForConnection([visible, hidden, 'user-1'], 'conn-2')).toEqual([visible]);
  });
});
