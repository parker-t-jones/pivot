import * as SecureStore from 'expo-secure-store';

import { readOrCreateDeviceId } from './deviceIdStorage';

export function getOrCreateDeviceId(): Promise<string> {
  return readOrCreateDeviceId(
    {
      getItem: (key) => SecureStore.getItemAsync(key),
      setItem: (key, value) => SecureStore.setItemAsync(key, value),
    },
    () => globalThis.crypto.randomUUID(),
  );
}
