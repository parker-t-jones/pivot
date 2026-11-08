import type { GamePlayerStats, GameState, Segment } from '@pivot/shared';

/**
 * Game segments a line can cover (docs/P2-PICKS-MODEL.md §1). No segment is the full game
 * including OT. Q4 excludes OT. H2 includes it. Periods are 1–4, and 5+ is OT.
 */

const FIRST_PERIOD: Record<Segment, number> = { Q1: 1, Q2: 2, Q3: 3, Q4: 4, H1: 1, H2: 3 };

/** Last period of a segment that closes in regulation. H2 and the full game run into OT. */
const LAST_PERIOD: Partial<Record<Segment, number>> = { Q1: 1, Q2: 2, Q3: 3, Q4: 4, H1: 2 };

/** A quarter segment's "late" stretch is its last 5:00. */
export const SEGMENT_LATE_SECONDS = 300;

export function periodInSegment(period: number, segment: Segment | undefined): boolean {
  if (segment === undefined) return period >= 1;
  const last = LAST_PERIOD[segment];
  return period >= FIRST_PERIOD[segment] && (last === undefined || period <= last);
}

export function gameIsFinal(game: GameState, stats: GamePlayerStats | undefined): boolean {
  return game.status === 'final' || stats?.final === true;
}

export function segmentStarted(segment: Segment | undefined, game: GameState): boolean {
  if (game.status === 'final') return true;
  if (game.status !== 'in_progress') return false;
  return game.quarter >= (segment === undefined ? 1 : FIRST_PERIOD[segment]);
}

/** The segment can no longer change: the game is final, or play has moved past its last period. */
export function segmentComplete(
  segment: Segment | undefined,
  game: GameState,
  stats?: GamePlayerStats,
): boolean {
  if (gameIsFinal(game, stats)) return true;
  if (segment === undefined) return false;
  const last = LAST_PERIOD[segment];
  if (last === undefined) return false;
  return game.status === 'in_progress' && game.quarter > last;
}

export function segmentInPlay(
  segment: Segment | undefined,
  game: GameState,
  stats?: GamePlayerStats,
): boolean {
  return segmentStarted(segment, game) && !segmentComplete(segment, game, stats);
}

/**
 * Late in the segment: the last 5:00 of a quarter segment, Q2 for H1, and Q4 or OT for H2 and the
 * full game (the existing `isLate` rule).
 */
export function segmentLate(segment: Segment | undefined, game: GameState): boolean {
  if (game.status !== 'in_progress') return false;
  if (segment === undefined || segment === 'H2') return game.quarter >= 4;
  if (segment === 'H1') return game.quarter === 2;
  return game.quarter === FIRST_PERIOD[segment] && game.timeRemainingSec <= SEGMENT_LATE_SECONDS;
}

/** One side's points in the segment. Full game reads the live score; segments read linescores. */
export function segmentPoints(
  side: 'home' | 'away',
  segment: Segment | undefined,
  game: GameState,
  stats: GamePlayerStats | undefined,
): number {
  if (segment === undefined) return side === 'home' ? game.scoreHome : game.scoreAway;
  const periods = stats?.linescores[side] ?? [];
  return periods.reduce(
    (sum, points, index) => (periodInSegment(index + 1, segment) ? sum + points : sum),
    0,
  );
}

export function sideOf(game: GameState, teamId: string): 'home' | 'away' | null {
  if (teamId === game.homeTeamId) return 'home';
  if (teamId === game.awayTeamId) return 'away';
  return null;
}
