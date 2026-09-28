import { describe, expect, it, vi } from 'vitest';
import type { IngestAiringsResult } from '@pivot/ingestion';
import {
  AIRINGS_DAILY_INTERVAL_MS,
  AIRINGS_IN_SEASON_INTERVAL_MS,
  airingsIntervalMs,
  nextAiringsDelayMs,
  runAiringsCycle,
} from './airingsCycle.js';

const RESULT: IngestAiringsResult = {
  events: 16,
  rows: 17,
  games: 16,
  deleted: 0,
  unmapped: 2,
  unmatchedEventIds: [],
};

// 2026-10-01 is a Thursday. 03:30Z is still Wednesday 23:30 in New York (EDT); 04:30Z is Thursday.
const WED_LATE_ET = new Date('2026-10-01T03:30:00Z');
const THU_EARLY_ET = new Date('2026-10-01T04:30:00Z');
const MON_NIGHT_ET = new Date('2026-10-06T03:00:00Z'); // Mon 23:00 ET
const TUE_ET = new Date('2026-10-06T16:00:00Z');

describe('airingsIntervalMs', () => {
  it('runs every 15 minutes Thursday through Monday in season, by the New York calendar', () => {
    expect(airingsIntervalMs(THU_EARLY_ET, 'regular')).toBe(AIRINGS_IN_SEASON_INTERVAL_MS);
    expect(airingsIntervalMs(new Date('2026-10-04T17:00:00Z'), 'regular')).toBe(
      AIRINGS_IN_SEASON_INTERVAL_MS,
    ); // Sunday
    expect(airingsIntervalMs(MON_NIGHT_ET, 'regular')).toBe(AIRINGS_IN_SEASON_INTERVAL_MS);
    expect(airingsIntervalMs(new Date('2027-01-16T21:00:00Z'), 'post')).toBe(
      AIRINGS_IN_SEASON_INTERVAL_MS,
    ); // playoff Saturday
  });

  it('runs daily Tuesday and Wednesday in season', () => {
    expect(airingsIntervalMs(TUE_ET, 'regular')).toBe(AIRINGS_DAILY_INTERVAL_MS);
    expect(airingsIntervalMs(WED_LATE_ET, 'regular')).toBe(AIRINGS_DAILY_INTERVAL_MS);
  });

  it('runs daily in the offseason and preseason, whatever the weekday', () => {
    expect(airingsIntervalMs(new Date('2026-08-16T17:00:00Z'), 'pre')).toBe(
      AIRINGS_DAILY_INTERVAL_MS,
    ); // Sunday
    expect(airingsIntervalMs(new Date('2026-06-07T17:00:00Z'), 'off')).toBe(
      AIRINGS_DAILY_INTERVAL_MS,
    ); // Sunday
  });
});

describe('runAiringsCycle', () => {
  it('logs the row, game and unmapped counts', async () => {
    const log = vi.fn();
    await runAiringsCycle({ ingest: () => Promise.resolve(RESULT), phase: vi.fn(), log });
    expect(log).toHaveBeenCalledWith('[runner] airings: 17 rows across 16 games, 2 unmapped');
  });

  it('logs a failed cycle instead of throwing', async () => {
    const logError = vi.fn();
    await expect(
      runAiringsCycle({
        ingest: () => Promise.reject(new Error('scoreboard failed: ESPN request failed: 503')),
        phase: vi.fn(),
        log: vi.fn(),
        logError,
      }),
    ).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith(
      '[runner] airings failed: scoreboard failed: ESPN request failed: 503',
    );
  });
});

describe('nextAiringsDelayMs', () => {
  it('uses the current display phase', async () => {
    const delay = await nextAiringsDelayMs({
      ingest: vi.fn(),
      phase: () => Promise.resolve('pre'),
      now: () => THU_EARLY_ET,
    });
    expect(delay).toBe(AIRINGS_DAILY_INTERVAL_MS);
  });

  it('falls back to in season when the phase lookup fails', async () => {
    const logError = vi.fn();
    const delay = await nextAiringsDelayMs({
      ingest: vi.fn(),
      phase: () => Promise.reject(new Error('sleeper down')),
      now: () => THU_EARLY_ET,
      logError,
    });
    expect(delay).toBe(AIRINGS_IN_SEASON_INTERVAL_MS);
    expect(logError).toHaveBeenCalledWith(
      '[runner] airings phase lookup failed, assuming in season: sleeper down',
    );
  });
});
