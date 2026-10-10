import * as SecureStore from 'expo-secure-store';

/**
 * Native session storage. Metro loads `authStorage.web.ts` instead of this file on web, because a
 * static `expo-secure-store` import throws there (`requireNativeModule('ExpoSecureStore')`) before
 * any `Platform.OS` check could run. iOS and Android keep this adapter.
 */
export const authStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};
