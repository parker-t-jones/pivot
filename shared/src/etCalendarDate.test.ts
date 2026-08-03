import { describe, expect, it } from 'vitest';
import { etCalendarDateFromUtc } from './etCalendarDate.js';

describe('etCalendarDateFromUtc', () => {
  it('maps a Thursday-night kickoff (UTC next day) to the ET calendar day', () => {
    // 2026 Week 1 opener: Thu Sep 9, 8:20pm ET = 2026-09-10T00:20:00Z
    expect(etCalendarDateFromUtc('2026-09-10T00:20:00Z')).toBe('2026-09-09');
  });

  it('maps the 2026 Hall of Fame / preseason opener to Aug 6 ET, not Aug 7 UTC', () => {
    // 2026-08-07T00:00:00Z = Aug 6 evening ET
    expect(etCalendarDateFromUtc('2026-08-07T00:00:00Z')).toBe('2026-08-06');
  });

  it('keeps an afternoon ET kickoff on the same calendar day', () => {
    // 1:00pm ET Sunday = 17:00Z same calendar day
    expect(etCalendarDateFromUtc('2026-09-13T17:00:00Z')).toBe('2026-09-13');
  });
});
