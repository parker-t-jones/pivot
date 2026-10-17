import { describe, expect, it } from 'vitest';

import { kickoffLabel } from './kickoffLabel';

const HOUR_MS = 60 * 60 * 1000;

describe('kickoffLabel', () => {
  it('uses Eastern weekday and time past 24 hours, in both DST offsets', () => {
    const winterKickoff = new Date('2026-01-11T14:30:00.000Z');
    const winterNow = new Date(winterKickoff.getTime() - 26 * HOUR_MS);
    expect(kickoffLabel(winterKickoff, winterNow)).toBe('SUN 9:30 AM');

    const summerKickoff = new Date('2026-10-18T13:30:00.000Z');
    const summerNow = new Date(summerKickoff.getTime() - 26 * HOUR_MS);
    expect(kickoffLabel(summerKickoff, summerNow)).toBe('SUN 9:30 AM');
  });

  it('counts down at exactly 24 hours and at 23h 59m', () => {
    const now = new Date('2026-10-18T13:30:00.000Z');
    expect(kickoffLabel(new Date(now.getTime() + 24 * HOUR_MS), now)).toBe('24h 0m');
    expect(kickoffLabel(new Date(now.getTime() + 23 * HOUR_MS + 59 * 60_000), now)).toBe(
      '23h 59m',
    );
  });

  it('switches from hours to minutes at one hour', () => {
    const now = new Date('2026-10-18T13:30:00.000Z');
    expect(kickoffLabel(new Date(now.getTime() + 60 * 60_000), now)).toBe('1h 0m');
    expect(kickoffLabel(new Date(now.getTime() + 59 * 60_000), now)).toBe('59m');
  });

  it('keeps the existing countdown once the kickoff has started', () => {
    const now = new Date('2026-10-18T13:30:00.000Z');
    expect(kickoffLabel(new Date(now.getTime() - 60_000), now)).toBe('soon');
  });
});
