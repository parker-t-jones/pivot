import { describe, expect, it } from 'vitest';
import { InMemoryUsageCounter, slipImportFreeKey, slipImportProKey } from './quota.js';

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

describe('slipImportProKey', () => {
  it('uses the US Eastern day, so a late-night import counts toward that evening', () => {
    // 03:30 UTC on Oct 12 is 11:30 PM Eastern on Oct 11.
    expect(slipImportProKey('u', new Date('2026-10-12T03:30:00Z'))).toBe(
      'slip_import:u:2026-10-11',
    );
    expect(slipImportProKey('u', new Date('2026-10-12T05:00:00Z'))).toBe(
      'slip_import:u:2026-10-12',
    );
  });
});

describe('slipImportFreeKey', () => {
  it('keys on the NFL season and week, so it survives a UTC midnight and resets on a new week', () => {
    const week5 = { season: '2026', week: 5 };
    expect(slipImportFreeKey('u', week5)).toBe('slip_import:u:2026:5');
    expect(slipImportFreeKey('u', { season: '2026', week: 6 })).toBe('slip_import:u:2026:6');
  });
});
