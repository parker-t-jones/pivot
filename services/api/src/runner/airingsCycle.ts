import type { IngestAiringsResult } from '@pivot/ingestion';
import type { NflPhase } from '../lib/phase-openers.js';

export const AIRINGS_IN_SEASON_INTERVAL_MS = 15 * 60 * 1000;
export const AIRINGS_DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

const IN_SEASON_FAST_DAYS = new Set(['Thu', 'Fri', 'Sat', 'Sun', 'Mon']);

const etWeekday = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
});

/**
 * B1 §3.4 / P0 §10: every 15 minutes Thursday through Monday (ET) during the season, daily
 * otherwise (off, pre, and Tue–Wed in season).
 */
export function airingsIntervalMs(now: Date, phase: NflPhase): number {
  const inSeason = phase === 'regular' || phase === 'post';
  return inSeason && IN_SEASON_FAST_DAYS.has(etWeekday.format(now))
    ? AIRINGS_IN_SEASON_INTERVAL_MS
    : AIRINGS_DAILY_INTERVAL_MS;
}

export interface AiringsCycleDeps {
  ingest: () => Promise<IngestAiringsResult>;
  /** Home display phase (schedule openers + Sleeper season type). */
  phase: () => Promise<NflPhase>;
  now?: () => Date;
  log?: (line: string) => void;
  logError?: (line: string) => void;
}

/** One cycle. Never throws: a failure is logged and the next cycle runs on schedule. */
export async function runAiringsCycle(deps: AiringsCycleDeps): Promise<void> {
  const log = deps.log ?? console.log;
  const logError = deps.logError ?? console.error;
  try {
    const result = await deps.ingest();
    log(
      `[runner] airings: ${result.rows} rows across ${result.games} games, ${result.unmapped} unmapped`,
    );
  } catch (error) {
    logError(`[runner] airings failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Delay until the next cycle. A failed phase lookup is logged and treated as in season. */
export async function nextAiringsDelayMs(deps: AiringsCycleDeps): Promise<number> {
  const now = deps.now ?? (() => new Date());
  let phase: NflPhase;
  try {
    phase = await deps.phase();
  } catch (error) {
    (deps.logError ?? console.error)(
      `[runner] airings phase lookup failed, assuming in season: ${error instanceof Error ? error.message : String(error)}`,
    );
    phase = 'regular';
  }
  return airingsIntervalMs(now(), phase);
}
