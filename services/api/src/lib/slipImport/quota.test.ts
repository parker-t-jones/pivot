import { describe, expect, it } from 'vitest';
import { InMemoryUsageCounter, slipImportWeeklyKey } from './quota.js';

describe('InMemoryUsageCounter', () => {
  it('counts up, gives back, and resets when the key expires', async () => {
    const clock = { now: 0 };
    const counter = new InMemoryUsageCounter(() => clock.now);
    expect(await counter.increment('k', 10)).toBe(1);
    expect(await counter.increment('k', 10)).toBe(2);
    await counter.decrement('k');
    expect(await counter.increment('k', 10)).toBe(2);
    clock.now = 10_001;
    expect(await counter.increment('k', 10)).toBe(1);
  });
});

describe('slipImportWeeklyKey', () => {
  it('keys on the NFL season and week, so it survives a UTC midnight and resets on a new week', () => {
    const week5 = { season: '2026', week: 5 };
    expect(slipImportWeeklyKey('u', week5)).toBe('slip_import:u:2026:5');
    expect(slipImportWeeklyKey('u', { season: '2026', week: 6 })).toBe('slip_import:u:2026:6');
  });
});
