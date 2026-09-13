/**
 * A team identifier as seen by the engine. Opaque string on purpose: a live flow may translate the
 * provider's team IDs → our `teams.id` UUIDs in the ingestion layer before building a `PlayEvent`,
 * so the engine sees UUIDs; the replay/integration flow and `EspnPlaySource` both use team
 * abbreviations (e.g. `'KC'`, `'LV'`). `computeFlagState` treats the id opaquely, so behavior is
 * identical either way (see sprint summary decision #3).
 */
export type TeamId = string;

/**
 * Normalized, source-agnostic play type. Both nflverse CSV rows and ESPN play-by-play entries map
 * into this enum in their respective `PlaySource`; the engine never sees raw source strings.
 * `applyPlayToState` maps these to `UnitOnField` (see that file for the offense / special teams /
 * none mapping and the kicker rationale).
 *
 * `end_half` is deliberately distinct from `end_period` even though both are clock stoppages, and
 * neither is `end_game`. Resumption detection (`resumptionWatcher.ts`) treats a quarter break as
 * something to wait through but halftime as something to abort on — halftime runs far longer than
 * the pause after any in-game stoppage, so collapsing the two would make the watcher sit through an
 * entire intermission. Sources that can't distinguish them (nflverse's `quarter_end`) map to
 * `end_period`.
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
  | 'end_half'
  | 'end_game';

/**
 * Normalized play event — the single shape the engine consumes, regardless of source. Maps cleanly
 * from nflverse CSV (`ReplayPlaySource`) and from ESPN's play-by-play (`EspnPlaySource`, in
 * `@pivot/ingestion`). This is the raw signal from the field; `applyPlayToState` folds it into a
 * `GameState`.
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
  /** Current down (1–4), or `null` when not a scrimmage situation / no possession. */
  down: number | null;
  /** Yards to go for a first down, or `null` when not a scrimmage situation / no possession. */
  distance: number | null;
  /** True when this play ends the game (drives `status` → `'final'`). */
  isFinalPlay: boolean;
}
