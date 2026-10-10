/** Browser session storage. `localStorage` throws in private mode and when blocked. */
export interface WebStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createWebAuthStorage(getStorage: () => WebStorage | undefined) {
  return {
    getItem: (key: string): Promise<string | null> => {
      try {
        return Promise.resolve(getStorage()?.getItem(key) ?? null);
      } catch {
        return Promise.resolve(null);
      }
    },
    setItem: (key: string, value: string): Promise<void> => {
      try {
        getStorage()?.setItem(key, value);
      } catch {
        // Quota or a blocked storage API. Sign-in still succeeds for this tab.
      }
      return Promise.resolve();
    },
    removeItem: (key: string): Promise<void> => {
      try {
        getStorage()?.removeItem(key);
      } catch {
        // Same as setItem: a storage failure must not reject the auth call.
      }
      return Promise.resolve();
    },
  };
}
