import * as Crypto from 'expo-crypto';

import { readOrCreateDeviceId } from './deviceIdStorage';

function browserStorage(): Storage | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    return localStorage;
  } catch {
    return undefined;
  }
}

export async function getOrCreateDeviceId(): Promise<string> {
  const deviceId = await readOrCreateDeviceId(browserStorage(), () => Crypto.randomUUID());
  console.log(`stored deviceId ${deviceId}`);
  return deviceId;
}
