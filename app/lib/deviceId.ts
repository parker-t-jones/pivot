import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { readOrCreateDeviceId } from './deviceIdStorage';

export async function getOrCreateDeviceId(): Promise<string> {
  const deviceId = await readOrCreateDeviceId(
    {
      getItem: (key) => SecureStore.getItemAsync(key),
      setItem: (key, value) => SecureStore.setItemAsync(key, value),
    },
    () => Crypto.randomUUID(),
  );
  console.log(`stored deviceId ${deviceId}`);
  return deviceId;
}
