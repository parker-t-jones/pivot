import { etCalendarDateFromInstant, etCalendarDateFromUtc } from '@fantasy-focus/shared';
import type { SupabaseServiceClient } from './supabase.js';

export type NflPhase = 'off' | 'pre' | 'regular' | 'post';

export interface PhaseOpeners {
  /** Date-only `YYYY-MM-DD` in America/New_York, or null if no pre games seeded. */
  preseasonStart: string | null;
  /** Date-only `YYYY-MM-DD` in America/New_York, or null if no regular games seeded. */
  regularSeasonStart: string | null;
}

/**
 * Phase openers from real `games` rows (Sprint 10 Phase 2.5) — not Sleeper's phase-relative
 * `season_start_date`. Calendar day is always America/New_York (NFL schedules are published in ET).
 */
export async function derivePhaseOpeners(supabase: SupabaseServiceClient): Promise<PhaseOpeners> {
  const [pre, regular] = await Promise.all([
    earliestScheduledStart(supabase, 'pre'),
    earliestScheduledStart(supabase, 'regular'),
  ]);
  return {
    preseasonStart: pre ? etCalendarDateFromUtc(pre) : null,
    regularSeasonStart: regular ? etCalendarDateFromUtc(regular) : null,
  };
}

/**
 * Home display phase from schedule openers + ET "today" — not Sleeper `season_type` (which runs
 * ahead of actual games). Pure + injectable `todayEt` for boundary tests.
 *
 * - today < preseason_start                         → off
 * - preseason_start <= today < regular_season_start → pre
 * - today >= regular_season_start                   → regular (never 'post' from this path)
 * - either opener null                              → fall back to season_type
 *
 * No season-end bound — see PLAN Known Issues (2027 offseason stays 'regular').
 */
export function deriveDisplayPhase(input: {
  preseasonStart: string | null;
  regularSeasonStart: string | null;
  seasonType: NflPhase;
  /** America/New_York calendar date `YYYY-MM-DD`. */
  todayEt: string;
}): NflPhase {
  const { preseasonStart, regularSeasonStart, seasonType, todayEt } = input;
  if (!preseasonStart || !regularSeasonStart) {
    return seasonType;
  }
  // Lexicographic compare is valid for zero-padded YYYY-MM-DD.
  if (todayEt < preseasonStart) return 'off';
  if (todayEt < regularSeasonStart) return 'pre';
  return 'regular';
}

/** Convenience: derive display_phase using the current instant's ET calendar day. */
export function deriveDisplayPhaseNow(
  openers: PhaseOpeners,
  seasonType: NflPhase,
  now: Date = new Date(),
): NflPhase {
  return deriveDisplayPhase({
    preseasonStart: openers.preseasonStart,
    regularSeasonStart: openers.regularSeasonStart,
    seasonType,
    todayEt: etCalendarDateFromInstant(now),
  });
}

async function earliestScheduledStart(
  supabase: SupabaseServiceClient,
  seasonType: 'pre' | 'regular',
): Promise<string | null> {
  const { data, error } = await supabase
    .from('games')
    .select('scheduled_start')
    .eq('season_type', seasonType)
    .order('scheduled_start', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.scheduled_start ?? null;
}
