/**
 * Home screen state-machine helpers (PLAN.md Section 10, Sprint 10 Phase 2).
 *
 * Pure functions — unit-tested without React. The screen loads data, then calls
 * `resolveHomeBranch` to pick which UI to render.
 */
import type { LineupResponse } from './leagues';
import type { NflSeasonType } from './nflState';
import type { LiveGame, ScheduleGame } from './schedule';
import type { PlayerTeamMap } from './teamDisplay';

/** How close a kickoff must be (same local day OR within this window) to count as State 3 pre-game. */
const PREGAME_WINDOW_MS = 12 * 60 * 60 * 1000;

export type HomeBranch =
  | { branch: 'no_leagues' }
  | { branch: 'season_idle'; variant: 'off' | 'pre' }
  | { branch: 'state1' }
  | { branch: 'state2' }
  | { branch: 'state3' }
  | { branch: 'state4' };

/**
 * Live Home machine + WebSocket gate (Sprint 10 Phase 2/3).
 * `true` only for schedule-derived `display_phase` `'regular' | 'post'`.
 * Home WS must use this — never `season_type`.
 */
export function isLiveDisplayPhase(phase: NflSeasonType): phase is 'regular' | 'post' {
  return phase === 'regular' || phase === 'post';
}

/** Whether Home should hold a `/realtime` socket — same phase gate as `resolveHomeBranch`'s live machine. */
export function shouldConnectHomeRealtime(input: {
  homeReady: boolean;
  hasLeagues: boolean;
  displayPhase: NflSeasonType | null;
}): boolean {
  return (
    input.homeReady &&
    input.hasLeagues &&
    input.displayPhase !== null &&
    isLiveDisplayPhase(input.displayPhase)
  );
}

/**
 * Sprint 10 Phase 2 — three-way display_phase branch (do NOT collapse 'pre' into 'off').
 *
 * Home keys off `/state/nfl` `display_phase` (schedule-derived), NOT Sleeper `season_type`
 * (which runs ahead of actual games).
 *
 * Rationale: 'off' and 'pre' both render the idle panel in v1 because neither has a usable stake
 * source (no fantasy preseason lineup from Sleeper; betting integration not built — PLAN Section 14).
 * They stay DISTINCT branches — not merged — because a future stake source (betting slips) would
 * make 'pre' a LIVE state. Promoting 'pre' later should be a localized change in this switch
 * (route 'pre' into the live machine below), not a rewrite of Home.
 *
 * Phase 3 WebSocket connect/disconnect uses `isLiveDisplayPhase` — the same predicate as the
 * live-machine cases below — so the phase gate is not re-implemented at the socket layer.
 */
export function resolveHomeBranch(input: {
  hasLeagues: boolean;
  /** Schedule-derived phase from `/state/nfl` `display_phase` — not Sleeper `season_type`. */
  displayPhase: NflSeasonType;
  hasFlags: boolean;
  hasLiveStakeGames: boolean;
  nextStakeKickoff: Date | null;
  now: Date;
}): HomeBranch {
  if (!input.hasLeagues) {
    return { branch: 'no_leagues' };
  }

  if (!isLiveDisplayPhase(input.displayPhase)) {
    // 'off' and 'pre' stay distinct — see docstring above. Do not merge these cases.
    return { branch: 'season_idle', variant: input.displayPhase };
  }

  // Live state machine (regular / post only).
  if (input.hasFlags) {
    return { branch: 'state1' };
  }
  if (input.hasLiveStakeGames) {
    return { branch: 'state2' };
  }
  if (input.nextStakeKickoff && isPregameWindow(input.now, input.nextStakeKickoff)) {
    return { branch: 'state3' };
  }
  return { branch: 'state4' };
}

export function isPregameWindow(now: Date, kickoff: Date): boolean {
  if (kickoff.getTime() < now.getTime()) return false;
  if (sameLocalCalendarDay(now, kickoff)) return true;
  return kickoff.getTime() - now.getTime() <= PREGAME_WINDOW_MS;
}

function sameLocalCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Team abbreviations the user has at least one rostered player on. */
export function stakeTeamAbbreviations(playerTeamMap: PlayerTeamMap): Set<string> {
  const teams = new Set<string>();
  for (const team of playerTeamMap.values()) {
    teams.add(team.abbreviation);
  }
  return teams;
}

export function gameHasStake(
  homeTeam: string,
  awayTeam: string,
  stakeTeams: Set<string>,
): boolean {
  return stakeTeams.has(homeTeam) || stakeTeams.has(awayTeam);
}

export function filterLiveStakeGames(
  liveGames: LiveGame[],
  stakeTeams: Set<string>,
): LiveGame[] {
  return liveGames.filter((g) => gameHasStake(g.home_team, g.away_team, stakeTeams));
}

/** Soonest future scheduled kickoff among games the user has stake in. */
export function nextStakeKickoff(
  weekGames: ScheduleGame[],
  stakeTeams: Set<string>,
  now: Date,
): Date | null {
  let soonest: Date | null = null;
  for (const game of weekGames) {
    if (game.status === 'final' || game.status === 'in_progress') continue;
    if (!gameHasStake(game.home_team, game.away_team, stakeTeams)) continue;
    const kickoff = new Date(game.scheduled_start);
    if (Number.isNaN(kickoff.getTime()) || kickoff.getTime() < now.getTime()) continue;
    if (!soonest || kickoff.getTime() < soonest.getTime()) {
      soonest = kickoff;
    }
  }
  return soonest;
}

export function findNextStakeGame(
  weekGames: ScheduleGame[],
  stakeTeams: Set<string>,
  now: Date,
): ScheduleGame | null {
  let best: ScheduleGame | null = null;
  let bestTime = Infinity;
  for (const game of weekGames) {
    if (game.status === 'final' || game.status === 'in_progress') continue;
    if (!gameHasStake(game.home_team, game.away_team, stakeTeams)) continue;
    const kickoff = new Date(game.scheduled_start).getTime();
    if (Number.isNaN(kickoff) || kickoff < now.getTime()) continue;
    if (kickoff < bestTime) {
      bestTime = kickoff;
      best = game;
    }
  }
  return best;
}

export function countStakePlayersInGame(
  lineups: LineupResponse[],
  homeTeam: string,
  awayTeam: string,
): number {
  const ids = new Set<string>();
  for (const lineup of lineups) {
    for (const slot of lineup.slots) {
      const abbr = slot.player.team?.abbreviation;
      if (abbr === homeTeam || abbr === awayTeam) {
        ids.add(slot.player.player_id);
      }
    }
  }
  return ids.size;
}

export interface LineupGameGroup {
  game: ScheduleGame;
  players: Array<{
    player_id: string;
    first_name: string;
    last_name: string;
    position: string;
    team_abbreviation: string;
  }>;
}

/** Lineup slots grouped under stake games, sorted by kickoff ascending. */
export function groupLineupByGame(
  weekGames: ScheduleGame[],
  lineups: LineupResponse[],
  stakeTeams: Set<string>,
): LineupGameGroup[] {
  const playersByTeam = new Map<
    string,
    Array<{
      player_id: string;
      first_name: string;
      last_name: string;
      position: string;
      team_abbreviation: string;
    }>
  >();

  for (const lineup of lineups) {
    for (const slot of lineup.slots) {
      const abbr = slot.player.team?.abbreviation;
      if (!abbr) continue;
      const list = playersByTeam.get(abbr) ?? [];
      if (!list.some((p) => p.player_id === slot.player.player_id)) {
        list.push({
          player_id: slot.player.player_id,
          first_name: slot.player.first_name,
          last_name: slot.player.last_name,
          position: slot.player.position,
          team_abbreviation: abbr,
        });
      }
      playersByTeam.set(abbr, list);
    }
  }

  const groups: LineupGameGroup[] = [];
  const sorted = weekGames
    .filter((g) => gameHasStake(g.home_team, g.away_team, stakeTeams))
    .slice()
    .sort(
      (a, b) =>
        new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime(),
    );

  for (const game of sorted) {
    const homePlayers = playersByTeam.get(game.home_team) ?? [];
    const awayPlayers = playersByTeam.get(game.away_team) ?? [];
    const seen = new Set<string>();
    const players = [...homePlayers, ...awayPlayers].filter((p) => {
      if (seen.has(p.player_id)) return false;
      seen.add(p.player_id);
      return true;
    });
    if (players.length === 0) continue;
    groups.push({ game, players });
  }

  return groups;
}

export interface SeasonIdleCopy {
  heading: string;
  /** Optional season-year caption (e.g. "2026 season"). */
  seasonLine: string | null;
  body: string;
  leagueLine: string;
}

/**
 * Formats a date-only `YYYY-MM-DD` for display ("August 6") without `new Date(iso)` —
 * that parses as UTC midnight and shifts the calendar day west of UTC (e.g. Aug 6 → Aug 5 ET).
 */
export function formatDateOnlyLabel(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Local calendar components — not UTC.
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

/**
 * State 4a copy. Uses schedule-derived openers from `/state/nfl` (`preseason_start` /
 * `regular_season_start`), never Sleeper's phase-relative `season_start_date`. When the relevant
 * opener is null (empty games table / seed not run), fall back to date-free copy.
 */
export function seasonIdleCopy(
  variant: 'off' | 'pre',
  season: string,
  leagueCount: number,
  openers: { preseasonStart: string | null; regularSeasonStart: string | null } = {
    preseasonStart: null,
    regularSeasonStart: null,
  },
): SeasonIdleCopy {
  const leagueLine =
    leagueCount === 1
      ? '1 league connected'
      : `${leagueCount} leagues connected`;
  const seasonLine = season.length > 0 ? `${season} season` : null;

  if (variant === 'off') {
    const opener = openers.preseasonStart;
    return {
      heading: 'Offseason',
      seasonLine,
      body: opener
        ? `Preseason begins ${formatDateOnlyLabel(opener)}.`
        : "The season hasn't started yet. We'll start flagging your players when it does.",
      leagueLine,
    };
  }

  const opener = openers.regularSeasonStart;
  return {
    heading: 'Preseason',
    seasonLine,
    body: opener
      ? `Regular season begins ${formatDateOnlyLabel(opener)}.`
      : "Preseason is underway. We'll start flagging your players once the regular season begins.",
    leagueLine,
  };
}

/** "2h 14m" style duration for State 3 countdown. */
export function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return 'soon';
}

/** "Thursday 8:20pm ET" style for State 4 next-game line (local timezone label). */
export function formatNextGameWhen(isoStart: string): string {
  const date = new Date(isoStart);
  if (Number.isNaN(date.getTime())) return isoStart;
  const day = date.toLocaleDateString('en-US', { weekday: 'long' });
  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${day} ${time}`;
}
