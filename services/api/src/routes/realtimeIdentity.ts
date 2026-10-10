import { isDeviceId, type PresencePlatform } from '@pivot/dispatcher';

export type RealtimeIdentity =
  | { kind: 'legacy' }
  | { kind: 'device'; deviceId: string; platform: PresencePlatform }
  | { kind: 'reject'; message: string };

function queryString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  return value;
}

/**
 * Current TestFlight sends neither param and stays the legacy iOS slot.
 * A web connection must name a device. `deviceId` is a UUID so it cannot be `legacy-ios`.
 */
export function resolveRealtimeIdentity(query: unknown): RealtimeIdentity {
  if (typeof query !== 'object' || query === null) {
    return { kind: 'legacy' };
  }
  const record = query as Record<string, unknown>;
  const deviceId = queryString(record['deviceId']);
  const platform = queryString(record['platform']);
  if (deviceId === null || platform === null) {
    return { kind: 'reject', message: 'deviceId and platform must be strings.' };
  }

  if (deviceId === undefined || deviceId.length === 0) {
    if (platform === undefined || platform.length === 0 || platform === 'ios') {
      return { kind: 'legacy' };
    }
    if (platform === 'web') {
      return { kind: 'reject', message: 'A web connection must send deviceId.' };
    }
    return { kind: 'reject', message: 'platform must be "ios" or "web".' };
  }

  if (!isDeviceId(deviceId)) {
    return { kind: 'reject', message: 'deviceId must be a UUID.' };
  }
  if (platform !== 'ios' && platform !== 'web') {
    return { kind: 'reject', message: 'platform must be "ios" or "web".' };
  }
  return { kind: 'device', deviceId, platform };
}
