import type { GameState, UnitOnField } from '@pivot/shared';
import { defaultClock, type Clock } from './clock.js';
import { classifyPlayType } from './resumptionWatcher.js';
import type { PlayEvent, PlayType } from './playEvent.js';

const RED_ZONE_YARDLINE = 20;

/**
 * Play types where the possessing team's offense is on the field. Note `field_goal`, `extra_point`,
 * `punt`, and `kickoff` are deliberately NOT here — they are special-teams plays and map to
 * `'special_teams'` below, which does not trigger flags in v1 (Section 8).
 *
 * ⚠️ Do NOT "fix" this by moving field goals / extra points into the offense set to make a kicker
 * owner flag on the kick. Section 8 handles kickers differently: a kicker inherits their team's
 * *offense* flag via the lineup cache (K is categorized as `'offense'` in `refreshLineupCache`), so a
 * kicker owner is flagged during their team's normal offensive drives — NOT during the special-teams
 * FG/XP snap itself. Treating FG/XP as offense here would double-count and flag on kicks, which is
 * explicitly out of scope for v1 ("Special handling for kickers", Section 4).
 */
const OFFENSE_PLAY_TYPES: ReadonlySet<PlayType> = new Set<PlayType>([
  'pass',
  'run',
  'qb_kneel',
  'qb_spike',
  'two_point_attempt',
]);

const SPECIAL_TEAMS_PLAY_TYPES: ReadonlySet<PlayType> = new Set<PlayType>([
  'punt',
  'field_goal',
  'kickoff',
  'extra_point',
]);

function unitOnFieldFor(play: PlayEvent): UnitOnField {
  if (play.possessionTeamId === null) return 'none';
  if (OFFENSE_PLAY_TYPES.has(play.playType)) return 'offense';
  if (SPECIAL_TEAMS_PLAY_TYPES.has(play.playType)) return 'special_teams';
  return 'none';
}

type PossessionFields = Pick<
  GameState,
  'possessionTeamId' | 'unitOnField' | 'yardsToOpponentEndzone' | 'down' | 'distance' | 'inRedZone'
>;

/**
 * True when `play` doesn't actually change anything about who has the ball or what unit is on the
 * field, so `possessionFieldsFor` should carry `previous`'s possession-derived fields forward instead
 * of recomputing them from `play` (which would wipe them to null/`'none'`).
 *
 * Two cases, both confirmed live against real ESPN data on Sept 13, 2026 (see
 * `experiments/LIVE-SUNDAY-FINDINGS.md`, Finding 1):
 *
 * - A `SKIP_AND_WAIT` clock stoppage (timeout, two-minute warning) — these always carry
 *   `possessionTeamId: null` (see `espnPlayTypeMap.ts`), but they pause the same drive rather than
 *   ending anyone's possession.
 * - A `no_play` (pre-snap penalty) that names the SAME possessing team as `previous` — the drive is
 *   continuing, not starting fresh. Deliberately narrower than "every `no_play` carries forward":
 *   `espnPlayTypeMap.ts` also uses `no_play` for a penalty on the very first play naming a brand-new
 *   possessing team, where it's genuinely ambiguous whether that team's offense is on the field yet —
 *   that case (possessionTeamId differs from `previous`, or `previous` is unknown) still falls
 *   through to the original "no unit on the field" answer.
 *
 * `ABORT` plays (`end_half`/`end_game`) are deliberately excluded from both cases: those are real
 * intermissions, and the next possession change should start clean rather than inherit stale
 * red-zone/down-and-distance state from the half that just ended.
 */
function continuesPreviousPossession(play: PlayEvent, previous: GameState): boolean {
  if (play.possessionTeamId === null) {
    return classifyPlayType(play.playType) === 'SKIP_AND_WAIT' || play.playType === 'no_play';
  }
  return play.playType === 'no_play' && play.possessionTeamId === previous.possessionTeamId;
}

/**
 * "Who has the ball, and what are they doing with it" — collapsed to null/`'none'` on any play that
 * doesn't already have possession-derived fields it can safely carry forward from `previous` (see
 * `continuesPreviousPossession`). Without this, a mid-drive timeout or pre-snap-penalty `no_play`
 * would momentarily zero `unitOnField` and `inRedZone`, and `computeFlagState` would read that as the
 * flag (and the red-zone bonus) turning off, then back on on the very next snap — a spurious
 * `flag_removed`/`flag_added` (or `priority_decreased`/`priority_increased`) pair with no actual
 * possession change.
 */
function possessionFieldsFor(play: PlayEvent, previous: GameState | null): PossessionFields {
  if (previous && continuesPreviousPossession(play, previous)) {
    return {
      possessionTeamId: previous.possessionTeamId,
      unitOnField: previous.unitOnField,
      yardsToOpponentEndzone: previous.yardsToOpponentEndzone,
      down: previous.down,
      distance: previous.distance,
      inRedZone: previous.inRedZone,
    };
  }

  return {
    possessionTeamId: play.possessionTeamId,
    unitOnField: unitOnFieldFor(play),
    yardsToOpponentEndzone: play.yardsToOpponentEndzone,
    down: play.down,
    distance: play.distance,
    inRedZone:
      play.possessionTeamId !== null &&
      play.yardsToOpponentEndzone !== null &&
      play.yardsToOpponentEndzone <= RED_ZONE_YARDLINE,
  };
}

/**
 * Pure projection of a normalized `PlayEvent` onto a `GameState` (PLAN.md Section 8 `applyPlayToState`).
 *
 * `previous` is part of the Section 8 signature (`onPlayEvent` passes the prior state so the result
 * can be diffed). Every field except the possession-derived ones is still derived purely from `play`
 * — our normalized `PlayEvent` is self-describing for those. The possession-derived fields
 * (`possessionTeamId`, `unitOnField`, `yardsToOpponentEndzone`, `down`, `distance`, `inRedZone`) are
 * the one place `previous` is actually read, via `possessionFieldsFor`: a `SKIP_AND_WAIT` clock
 * stoppage carries them forward from `previous` rather than zeroing them, since the stoppage doesn't
 * end anyone's possession (see that function's doc comment and Finding 1 in
 * `experiments/LIVE-SUNDAY-FINDINGS.md`).
 * `clock` supplies `updatedAt` (the only non-play input) — injected for determinism (decision #1).
 *
 * @remarks Section 6 places `applyPlayToState` in the ingestion service, but the transformation is
 * engine-owned domain logic. `@pivot/ingestion`'s `EspnPlaySource` exists (Section 5/8) but isn't
 * wired into this function yet; once it is, ingestion will import this from the engine package and
 * translate ESPN team abbreviations → our UUIDs before calling it (decision #2/#3). Ingestion is
 * transport; this function is the domain.
 */
export function applyPlayToState(
  previous: GameState | null,
  play: PlayEvent,
  clock: Clock = defaultClock,
): GameState {
  const isFinal = play.isFinalPlay || play.playType === 'end_game';

  return {
    gameId: play.gameId,
    homeTeamId: play.homeTeamId,
    awayTeamId: play.awayTeamId,
    ...possessionFieldsFor(play, previous),
    scoreHome: play.scoreHome,
    scoreAway: play.scoreAway,
    quarter: play.quarter,
    timeRemainingSec: play.secondsRemainingInQuarter,
    status: isFinal ? 'final' : 'in_progress',
    updatedAt: clock(),
  };
}
