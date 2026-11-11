import type { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InMemoryResumptionOpenStore,
  ResumptionCeiling,
  RESUMPTION_OPEN_TTL_SECONDS,
} from '@pivot/dispatcher';
import { tcpResumptionOpenStore } from './tcpRedis.js';

function fakeRedis() {
  const rows = new Map<string, { value: string; expiresAt: number }>();
  return {
    set: vi.fn(async (key: string, value: string, _ex: string, seconds: number) => {
      rows.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
    }),
    get: async (key: string) => {
      const row = rows.get(key);
      if (row && row.expiresAt <= Date.now()) {
        rows.delete(key);
        return null;
      }
      return row?.value ?? null;
    },
    del: async (key: string) => {
      rows.delete(key);
    },
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());
const TTL = RESUMPTION_OPEN_TTL_SECONDS * 1000;
const record = { openedAt: 0, revealingPlayId: 'p' };

describe.each([
  ['TCP', () => tcpResumptionOpenStore(fakeRedis() as unknown as Redis)],
  ['in-memory', () => new InMemoryResumptionOpenStore()],
])('%s resumption retention', (_name, make) => {
  it('expires at one hour, without read refresh, and does not fire after a late restart', async () => {
    const store = make();
    await store.put('resumption_open:g', record);
    vi.setSystemTime(TTL - 1);
    expect(await store.read('resumption_open:g')).toEqual(record);
    vi.setSystemTime(TTL);
    const onFire = vi.fn();
    const ceiling = new ResumptionCeiling({ store, onFire });
    await ceiling.rearm('g');
    expect(await store.read('resumption_open:g')).toBeNull();
    expect(onFire).not.toHaveBeenCalled();
    ceiling.stop();
  });
  it('refreshes writes, isolates games, and preserves explicit deletion', async () => {
    const store = make();
    await store.put('a', record);
    await store.put('b', record);
    vi.setSystemTime(TTL - 1);
    const next = { openedAt: TTL - 1, revealingPlayId: 'next' };
    await store.put('a', next);
    vi.setSystemTime(TTL);
    expect(await store.read('a')).toEqual(next);
    expect(await store.read('b')).toBeNull();
    await store.delete('a');
    expect(await store.read('a')).toBeNull();
  });
  it('still fires an overdue ceiling on restart within retention', async () => {
    const store = make();
    await store.put('resumption_open:g', record);
    vi.setSystemTime(5 * 60 * 1000);
    const onFire = vi.fn();
    const ceiling = new ResumptionCeiling({ store, onFire });
    await ceiling.rearm('g');
    expect(onFire).toHaveBeenCalledWith('g');
    expect(await store.read('resumption_open:g')).toBeNull();
    ceiling.stop();
  });
});
it('uses atomic SET EX on every TCP put', async () => {
  const client = fakeRedis();
  const store = tcpResumptionOpenStore(client as unknown as Redis);
  await store.put('resumption_open:g', record);
  await store.put('resumption_open:g', record);
  expect(client.set).toHaveBeenCalledTimes(2);
  expect(client.set).toHaveBeenCalledWith('resumption_open:g', JSON.stringify(record), 'EX', 3600);
});
