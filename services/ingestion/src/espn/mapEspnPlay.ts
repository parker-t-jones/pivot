import type { PlayEvent, PlayType, TeamId } from '@pivot/engine';
import { espnTypeIdToPlayType } from './espnPlayTypeMap.js';
import type { EspnDrive, EspnPlay, EspnSummary } from './espnTypes.js';

/**
 * Pure translation of ESPN's play-by-play into the engine's normalized `PlayEvent`. Everything
 * ESPN-shaped stops here: `@pivot/engine` sees only `PlayEvent`, so a future provider swap means
 * writing a sibling of this file rather than touching validated logic (PLAN.md Section 2).
 */

/**
 * ESPN uses `WSH`; our `teams.abbreviation` seed uses `WAS`. Mirrors
 * `ESPN_TEAM_ABBREVIATION_OVERRIDES` in `scripts/fetch-nfl-schedule.ts`, which resolves the same
 * discrepancy when seeding the schedule — so the team ids on a `PlayEvent` match the ones on the
 * `games` rows those plays belong to. Duplicated rather than shared because `scripts/` is not a
 * workspace package; `scripts/seed-players.ts` already keeps its own copy for its own source.
 */
const ESPN_TEAM_ABBREVIATION_OVERRIDES: Readonly<Record<string, string>> = {
  WSH: 'WAS',
};

function resolveTeamAbbreviation(espnAbbreviation: string): TeamId {
  return ESPN_TEAM_ABBREVIATION_OVERRIDES[espnAbbreviation] ?? espnAbbreviation;
}

/**
 * Play types where no team holds the ball, per `PlayEvent.possessionTeamId`'s contract ("null when no
 * team possesses it — pre-snap, timeout, end of period/game").
 *
 * Listed explicitly instead of derived from `classifyPlayType`, even though the two sets currently
 * coincide: they answer different questions ("who has the ball" vs. "should the watcher wait"), and
 * tying them together would silently change possession mapping the next time resumption categories
 * are revised.
 */
const NO_POSSESSION_PLAY_TYPES: ReadonlySet<PlayType> = new Set<PlayType>([
  'timeout',
  'end_period',
  'end_half',
  'end_game',
]);

/** ESPN's `M:SS` game clock → seconds. Unparseable or absent → 0, matching `mapNflverseRow`. */
function parseClockToSeconds(displayValue: string | undefined): number {
  const match = /^(\d+):(\d{1,2})$/.exec((displayValue ?? '').trim());
  if (match === null) return 0;
  return Number(match[1] ?? '0') * 60 + Number(match[2] ?? '0');
}

/**
 * Game-level facts a single ESPN play doesn't carry. ESPN nests these on the summary's `header` rather
 * than repeating them per play, so they're resolved once per poll and passed in.
 */
export interface EspnGameContext {
  /** ESPN event id, used directly as `PlayEvent.gameId`. */
  gameId: string;
  week: number;
  homeTeamId: TeamId;
  awayTeamId: TeamId;
}

/**
 * Pulls the game-level context out of a validated summary, or `null` when ESPN didn't give us enough
 * to identify both teams — returning rather than throwing so the caller can report the shape failure
 * and skip the cycle, the same way `parseEspnEvent` handles a malformed event.
 *
 * `header.week` is a week *within a phase*, and `PlayEvent` has no season-type field, so preseason
 * week 4 and regular-season week 4 both surface as `4`. That's tolerable for v1 (fantasy lineups are
 * regular-season) but is the thing to fix first if preseason ever needs real lineup lookups.
 */
export function resolveGameContext(summary: EspnSummary, gameId: string): EspnGameContext | null {
  const competition = summary.header?.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === 'home')?.team?.abbreviation;
  const away = competitors.find((c) => c.homeAway === 'away')?.team?.abbreviation;
  if (home === undefined || away === undefined) return null;

  return {
    gameId,
    week: summary.header?.week ?? 0,
    homeTeamId: resolveTeamAbbreviation(home),
    awayTeamId: resolveTeamAbbreviation(away),
  };
}

/**
 * Pure map of one ESPN play (plus the drive containing it) → normalized `PlayEvent`. `isFinalPlay` is
 * decided by the caller, matching `mapNflverseRow`.
 *
 * Possession comes from the drive, never from `play.start.team`: on procedural entries ESPN's
 * `start.team` contradicts the drive's offense (see `espnPlayStartSchema`). The drive's team is also
 * the more useful answer on a kickoff, where ESPN files the kick under the *receiving* team's drive —
 * which is who has the ball once the play is over.
 */
export function mapEspnPlay(
  play: EspnPlay,
  drive: EspnDrive,
  context: EspnGameContext,
  isFinalPlay: boolean,
): PlayEvent {
  const playType = espnTypeIdToPlayType(play.type.id);
  const driveTeam = drive.team?.abbreviation;
  const hasPossession = !NO_POSSESSION_PLAY_TYPES.has(playType) && driveTeam !== undefined;

  return {
    playId: play.id,
    gameId: context.gameId,
    week: context.week,
    homeTeamId: context.homeTeamId,
    awayTeamId: context.awayTeamId,
    possessionTeamId: hasPossession ? resolveTeamAbbreviation(driveTeam) : null,
    playType,
    scoreHome: play.homeScore ?? 0,
    scoreAway: play.awayScore ?? 0,
    quarter: play.period?.number ?? 0,
    secondsRemainingInQuarter: parseClockToSeconds(play.clock?.displayValue),
    // Ignored without possession: ESPN reports 0 (or a stale value) on procedural entries.
    yardsToOpponentEndzone: hasPossession ? (play.start?.yardsToEndzone ?? null) : null,
    isFinalPlay,
  };
}
