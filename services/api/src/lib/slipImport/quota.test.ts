import { describe, expect, it } from 'vitest';
import { InMemoryUsageCounter, slipImportKey } from './quota.js';

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

describe('slipImportKey', () => {
  it('uses the US Eastern day, so a late-night import counts toward that evening', () => {
    // 03:30 UTC on Oct 12 is 11:30 PM Eastern on Oct 11.
    expect(slipImportKey('u', new Date('2026-10-12T03:30:00Z'))).toBe('slip_import:u:2026-10-11');
    expect(slipImportKey('u', new Date('2026-10-12T05:00:00Z'))).toBe('slip_import:u:2026-10-12');
  });
});
