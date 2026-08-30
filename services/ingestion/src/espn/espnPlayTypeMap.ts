import type { PlayType } from '@pivot/engine';

/**
 * ESPN `type.id` → normalized `PlayType`.
 *
 * This table is the only place ESPN's play taxonomy exists in the codebase. The engine's resumption
 * watcher and flag logic read `PlayType`, never a provider's raw ids, so replacing ESPN means writing
 * another table like this one rather than touching validated logic (PLAN.md Section 2, "swap-ready
 * architecture principle").
 *
 * Every id below was observed in real ESPN responses — 17 games covering 2026 preseason, 2025 regular
 * season weeks 1 and 12, and 2025 postseason — not inferred from documentation (there is none) or
 * from the free-text description. The clock-stoppage group is the load-bearing part: those ids are
 * what `classifyPlayType` keys on to decide whether to wait through a pause, abort, or fire.
 *
 * Approximations worth knowing about, all of which are behaviorally equivalent for the two consumers
 * that read `PlayType` (`classifyPlayType` and `applyPlayToState`'s unit-on-field mapping):
 *
 * - The two-minute warning is not literally a timeout, but it is the same kind of clock stoppage and
 *   classifies identically (`SKIP_AND_WAIT`, no unit on the field).
 * - "End of Regulation" maps to `end_half` rather than `end_period`: the break before overtime is a
 *   real intermission, so aborting and letting the next possession change restart the flow is right,
 *   the same reasoning `end_half` exists for.
 * - Fumble recoveries carry no indication of whether the underlying snap was a run or a pass, so they
 *   land on `run`. Both map to `'offense'`, so the choice cannot change flag behavior.
 * - `Penalty` maps to `no_play`. Observed penalty entries are pre-snap fouls that wipe the play, and
 *   treating an ambiguous entry as "no unit on the field" avoids fabricating a flag from it.
 *
 * Two known gaps, both inherent to the source rather than to this table:
 *
 * - `extra_point` and `two_point_attempt` are unreachable from ESPN. PATs and two-point tries are not
 *   emitted as their own plays; they are folded into the touchdown entry's text and score. Nothing is
 *   lost — special-teams plays do not trigger flags in v1 anyway (PLAN.md Section 8).
 * - `qb_kneel` and `qb_spike` have no distinct ids either; kneels arrive as `Rush`. They therefore map
 *   to `run` (offense) instead of being distinguishable, which is only a fidelity gap, not a
 *   correctness one, for v1.
 */
const ESPN_TYPE_ID_TO_PLAY_TYPE: Readonly<Record<string, PlayType>> = {
  // Clock stoppages — what resumption detection classifies on.
  '21': 'timeout', // Timeout
  '74': 'timeout', // Official Timeout
  '75': 'timeout', // Two-minute warning
  '2': 'end_period', // End Period
  '65': 'end_half', // End of Half
  '79': 'end_half', // End of Regulation
  '66': 'end_game', // End of Game

  // Pass plays.
  '3': 'pass', // Pass Incompletion
  '7': 'pass', // Sack
  '24': 'pass', // Pass Reception
  '26': 'pass', // Pass Interception Return
  '36': 'pass', // Interception Return Touchdown
  '67': 'pass', // Passing Touchdown
  '80': 'pass', // Sack Opp Fumble Recovery

  // Run plays.
  '5': 'run', // Rush
  '9': 'run', // Fumble Recovery (Own)
  '29': 'run', // Fumble Recovery (Opponent)
  '68': 'run', // Rushing Touchdown

  // Special teams.
  '17': 'punt', // Blocked Punt
  '30': 'punt', // Muffed Punt Recovery (Opponent)
  '52': 'punt', // Punt
  '32': 'kickoff', // Kickoff Return Touchdown
  '53': 'kickoff', // Kickoff
  '59': 'field_goal', // Field Goal Good
  '60': 'field_goal', // Field Goal Missed

  // Non-plays.
  '8': 'no_play', // Penalty
};

/**
 * Where an unrecognized `type.id` lands.
 *
 * `no_play` is the deliberate choice because it fails safe in both directions at once. Resumption
 * detection classifies it `REAL_ACTION`, so an unknown type fires the notification rather than
 * leaving the watcher waiting forever; and `applyPlayToState` maps it to no unit on the field, so an
 * unknown type cannot invent an offensive snap and flag on it. ESPN's taxonomy is undocumented and
 * this table is built from observation, so unknown ids are an expected condition, not an error.
 */
export const ESPN_UNKNOWN_PLAY_TYPE: PlayType = 'no_play';

/** Pure lookup of ESPN's `type.id` against the observed taxonomy. */
export function espnTypeIdToPlayType(typeId: string): PlayType {
  return ESPN_TYPE_ID_TO_PLAY_TYPE[typeId] ?? ESPN_UNKNOWN_PLAY_TYPE;
}

/** Exposed so tests can assert the classification of every id we claim to have observed. */
export const OBSERVED_ESPN_TYPE_IDS: readonly string[] = Object.keys(ESPN_TYPE_ID_TO_PLAY_TYPE);
