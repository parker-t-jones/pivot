/**
 * A team identifier as seen by the engine. Opaque string on purpose: in the live Sportradar flow
 * the ingestion layer translates Sportradar team IDs → our `teams.id` UUIDs before building a
 * `PlayEvent`, so the engine sees UUIDs; in the Sprint 4 replay/integration flow both sides of every
 * comparison use nflverse team abbreviations (e.g. `'KC'`, `'LV'`). `computeFlagState` treats the id
 * opaquely, so behavior is identical either way (see sprint summary decision #3).
 */
export type TeamId = string;

/**
 * Normalized, source-agnostic play type. Both nflverse CSV rows and (eventually) Sportradar push
 * events map into this enum in their respective `PlaySource`; the engine never sees raw source
 * strings. `applyPlayToState` maps these to `UnitOnField` (see that file for the offense / special
 * teams / none mapping and the kicker rationale).
 */
export type PlayType =
  | 'pass'
  | 'run'
  | 'qb_kneel'
  | 'qb_spike'
  | 'two_point_attempt'
  | 'punt'
  | 'field_goal'
  | 'kickoff'
  | 'extra_point'
  | 'no_play'
  | 'timeout'
  | 'end_period'
  | 'end_game';

/**
 * Normalized play event — the single shape the engine consumes, regardless of source. Maps cleanly
 * from nflverse CSV (Sprint 4 `ReplayPlaySource`) and from Sportradar's push feed (later). This is
 * the raw signal from the field; `applyPlayToState` folds it into a `GameState`.
 *
 * `week` lives on the play, not on `GameState`: game state is what's true on the field right now,
 * whereas week is contextual season metadata used to select the correct lineup cache. Keeping them
 * separate matches how the data flows in production (sprint summary decision #5).
 */
export interface PlayEvent {
  playId: string;
  gameId: string;
  week: number;
  homeTeamId: TeamId;
  awayTeamId: TeamId;
  /** Team with the ball, or `null` when no team possesses it (pre-snap, timeout, end of period/game). */
  possessionTeamId: TeamId | null;
  playType: PlayType;
  scoreHome: number;
  scoreAway: number;
  quarter: number; // 1-5 (5 = OT)
  secondsRemainingInQuarter: number;
  /** Distance (yards) from the possessing team to the opponent's end zone; `null` when not applicable. */
  yardsToOpponentEndzone: number | null;
  /** True when this play ends the game (drives `status` → `'final'`). */
  isFinalPlay: boolean;
}
