import { createWebAuthStorage } from './webAuthStorage';

function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Web session storage. Not used on iOS. */
export const authStorage = createWebAuthStorage(browserStorage);
