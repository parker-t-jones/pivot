import { readOrCreateDeviceId } from './deviceIdStorage';

function browserStorage(): Storage | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    return localStorage;
  } catch {
    return undefined;
  }
}

export function getOrCreateDeviceId(): Promise<string> {
  return readOrCreateDeviceId(browserStorage(), () => globalThis.crypto.randomUUID());
}
