import { describe, expect, it } from 'vitest';
import { resolveRealtimeIdentity } from './realtimeIdentity.js';

const DEVICE = '11111111-1111-4111-8111-111111111111';

describe('resolveRealtimeIdentity', () => {
  it('treats a connection with no device info as legacy iOS', () => {
    expect(resolveRealtimeIdentity({})).toEqual({ kind: 'legacy' });
    expect(resolveRealtimeIdentity({ platform: 'ios' })).toEqual({ kind: 'legacy' });
    expect(resolveRealtimeIdentity(null)).toEqual({ kind: 'legacy' });
  });

  it('rejects a web connection with no deviceId', () => {
    expect(resolveRealtimeIdentity({ platform: 'web' })).toEqual({
      kind: 'reject',
      message: 'A web connection must send deviceId.',
    });
  });

  it('accepts a UUID deviceId with ios or web', () => {
    expect(resolveRealtimeIdentity({ deviceId: DEVICE, platform: 'ios' })).toEqual({
      kind: 'device',
      deviceId: DEVICE,
      platform: 'ios',
    });
    expect(resolveRealtimeIdentity({ deviceId: DEVICE, platform: 'web' })).toEqual({
      kind: 'device',
      deviceId: DEVICE,
      platform: 'web',
    });
  });

  it('rejects a non-UUID deviceId, including the reserved legacy id', () => {
    expect(resolveRealtimeIdentity({ deviceId: 'legacy-ios', platform: 'ios' }).kind).toBe('reject');
    expect(resolveRealtimeIdentity({ deviceId: 'not-a-uuid', platform: 'web' }).kind).toBe('reject');
    expect(resolveRealtimeIdentity({ deviceId: DEVICE }).kind).toBe('reject');
  });
});
