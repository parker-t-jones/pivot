import { describe, expect, it } from 'vitest';
import { readOrCreateDeviceId, type DeviceIdStorage } from './deviceIdStorage';

const FIXED = '11111111-1111-4111-8111-111111111111';

function memoryStorage(seed: Record<string, string> = {}): DeviceIdStorage & { values: Record<string, string> } {
  const values = { ...seed };
  return {
    values,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
  };
}

describe('readOrCreateDeviceId', () => {
  it('returns a stored UUID and writes a new one when missing', async () => {
    const stored = memoryStorage({ 'pivot.device-id': FIXED });
    await expect(readOrCreateDeviceId(stored, () => 'unused')).resolves.toBe(FIXED);

    const empty = memoryStorage();
    await expect(readOrCreateDeviceId(empty, () => FIXED)).resolves.toBe(FIXED);
    expect(empty.values['pivot.device-id']).toBe(FIXED);
  });

  it('still returns an id when storage throws', async () => {
    const storage: DeviceIdStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    await expect(readOrCreateDeviceId(storage, () => FIXED)).resolves.toBe(FIXED);
  });
});
