import type { GameState, UnitOnField } from '@roster-remote/shared';
import { defaultClock, type Clock } from './clock.js';
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

/**
 * Pure projection of a normalized `PlayEvent` onto a `GameState` (PLAN.md Section 8 `applyPlayToState`).
 *
 * `previous` is part of the Section 8 signature (`onPlayEvent` passes the prior state so the result
 * can be diffed) and is reserved for future sources that push partial updates; our normalized
 * `PlayEvent` is fully self-describing, so this projection derives the entire state from the play.
 * `clock` supplies `updatedAt` (the only non-play input) — injected for determinism (decision #1).
 *
 * @remarks Section 6 places `applyPlayToState` in the ingestion service, but the transformation is
 * engine-owned domain logic; when the real Sportradar consumer lands (Sprint 2), ingestion will
 * import this from the engine package and translate Sportradar team ids → our UUIDs before calling it
 * (decision #2/#3). Ingestion is transport; this function is the domain.
 */
export function applyPlayToState(
  _previous: GameState | null,
  play: PlayEvent,
  clock: Clock = defaultClock,
): GameState {
  const isFinal = play.isFinalPlay || play.playType === 'end_game';
  const inRedZone =
    play.possessionTeamId !== null &&
    play.yardsToOpponentEndzone !== null &&
    play.yardsToOpponentEndzone <= RED_ZONE_YARDLINE;

  return {
    gameId: play.gameId,
    homeTeamId: play.homeTeamId,
    awayTeamId: play.awayTeamId,
    possessionTeamId: play.possessionTeamId,
    unitOnField: unitOnFieldFor(play),
    scoreHome: play.scoreHome,
    scoreAway: play.scoreAway,
    quarter: play.quarter,
    timeRemainingSec: play.secondsRemainingInQuarter,
    inRedZone,
    status: isFinal ? 'final' : 'in_progress',
    updatedAt: clock(),
  };
}
