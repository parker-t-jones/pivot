import { describe, expect, it } from 'vitest';
import { createWebAuthStorage, type WebStorage } from './webAuthStorage';

function memoryStorage(): WebStorage & { dump: Map<string, string> } {
  const dump = new Map<string, string>();
  return {
    dump,
    getItem: (key) => dump.get(key) ?? null,
    setItem: (key, value) => {
      dump.set(key, value);
    },
    removeItem: (key) => {
      dump.delete(key);
    },
  };
}

describe('createWebAuthStorage', () => {
  it('round-trips a session value', async () => {
    const storage = memoryStorage();
    const adapter = createWebAuthStorage(() => storage);
    await adapter.setItem('sb-session', 'token');
    await expect(adapter.getItem('sb-session')).resolves.toBe('token');
    await adapter.removeItem('sb-session');
    await expect(adapter.getItem('sb-session')).resolves.toBeNull();
  });

  it('swallows a throwing storage API', async () => {
    const blocked: WebStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const adapter = createWebAuthStorage(() => blocked);
    await expect(adapter.setItem('k', 'v')).resolves.toBeUndefined();
    await expect(adapter.getItem('k')).resolves.toBeNull();
    await expect(adapter.removeItem('k')).resolves.toBeUndefined();
  });
});
