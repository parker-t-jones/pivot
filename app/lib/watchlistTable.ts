import { networkLabelFromAirings, type DestinationResolution } from '@pivot/shared/broadcast';

import { compactScoreLabel, liveClockLabel } from './gameDisplay';
import { kickoffLabel } from './kickoffLabel';
import { httpsWatchUrl } from './watchLink';

/** The week-game fields the table reads. Home and Watchlist already hold the full schedule row. */
export interface WatchlistTableGame {
  game_id: string;
  status: string;
  scheduled_start: string;
  home_team: string;
  away_team: string;
  airings: readonly { network: string }[];
  broadcasts: readonly { preferred: boolean; deep_link_url: string }[];
  destination?: DestinationResolution;
}

export interface WatchlistTableLive {
  game_id: string;
  score: { home: number; away: number };
  quarter: number;
  time_remaining_sec: number | null;
}

export interface WatchlistTableRow {
  id: string;
  slot: string;
  name: string;
  meta: string;
  /** Away @ home, or "Bye". */
  game: string;
  awayTeam: string | null;
  homeTeam: string | null;
  network: string;
  status: string;
  /** Final (and bye) stay in the muted status color. */
  statusMuted: boolean;
  live: boolean;
  gameId: string | null;
  /** https watch URL, or null when this row has nothing a browser can open. */
  deepLinkUrl: string | null;
  /** Matchup passed to the switch overlay. */
  switchLabel: string;
}

const EMPTY = '\u2014';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Status column. Inside a day, "in 1h 7m". Further out, the Eastern weekday and
 * time from `kickoffLabel`. Live is the score plus the clock when the live feed
 * has them, otherwise "LIVE". Final scores are not on the week schedule or the
 * live feed, so a finished game says FINAL.
 */
export function watchlistStatusLabel(input: {
  bye: boolean;
  isFinal: boolean;
  inProgress: boolean;
  kickoff: Date | null;
  now: Date;
  live: WatchlistTableLive | null;
}): { text: string; muted: boolean } {
  if (input.bye) return { text: 'BYE', muted: true };
  if (input.isFinal) return { text: 'FINAL', muted: true };
  if (input.inProgress) {
    if (!input.live) return { text: 'LIVE', muted: false };
    return {
      text: `${compactScoreLabel(input.live.score)} · ${liveClockLabel(input.live.quarter, input.live.time_remaining_sec)}`,
      muted: false,
    };
  }
  if (input.kickoff == null || Number.isNaN(input.kickoff.getTime())) {
    return { text: 'Upcoming', muted: false };
  }
  const label = kickoffLabel(input.kickoff, input.now);
  const ms = input.kickoff.getTime() - input.now.getTime();
  if (ms > DAY_MS) return { text: label, muted: false };
  if (ms <= 0) return { text: label, muted: false };
  return { text: `in ${label}`, muted: false };
}

export function watchlistPlayerRow(input: {
  id: string;
  slot: string;
  name: string;
  meta: string;
  teamAbbr: string;
  weekGames: readonly WatchlistTableGame[];
  liveGames: readonly WatchlistTableLive[];
  now: Date;
  timeZone: string;
}): WatchlistTableRow {
  const game = closestGame(input.weekGames, input.teamAbbr, input.now);
  return rowFromGame({
    id: input.id,
    slot: input.slot,
    name: input.name,
    meta: input.meta,
    teamAbbr: input.teamAbbr,
    game,
    liveGames: input.liveGames,
    now: input.now,
    timeZone: input.timeZone,
  });
}

export function watchlistStakeRow(input: {
  id: string;
  slot: string;
  name: string;
  meta: string;
  gameId: string;
  matchup: string;
  kickoff: string;
  weekGames: readonly WatchlistTableGame[];
  liveGames: readonly WatchlistTableLive[];
  now: Date;
  timeZone: string;
}): WatchlistTableRow {
  const game = input.weekGames.find((candidate) => candidate.game_id === input.gameId) ?? null;
  const live = input.liveGames.find((candidate) => candidate.game_id === input.gameId) ?? null;
  const status = game?.status ?? (live ? 'in_progress' : 'scheduled');
  const inProgress = status === 'in_progress' || live !== null;
  const kickoff = game ? new Date(game.scheduled_start) : null;
  const label = watchlistStatusLabel({
    bye: false,
    isFinal: status === 'final',
    inProgress,
    kickoff,
    now: input.now,
    live,
  });
  return {
    id: input.id,
    slot: input.slot,
    name: input.name,
    meta: input.meta,
    game: game ? `${game.away_team} @ ${game.home_team}` : input.matchup || EMPTY,
    awayTeam: game?.away_team ?? null,
    homeTeam: game?.home_team ?? null,
    network: game ? networkOrDash(game) : EMPTY,
    status: label.text,
    statusMuted: label.muted,
    live: inProgress && status !== 'final',
    gameId: game?.game_id ?? input.gameId,
    deepLinkUrl: preferredHttps(game),
    switchLabel: input.matchup || input.name,
  };
}

function rowFromGame(input: {
  id: string;
  slot: string;
  name: string;
  meta: string;
  teamAbbr: string;
  game: WatchlistTableGame | null;
  liveGames: readonly WatchlistTableLive[];
  now: Date;
  timeZone: string;
}): WatchlistTableRow {
  if (!input.game) {
    const label = watchlistStatusLabel({
      bye: true,
      isFinal: false,
      inProgress: false,
      kickoff: null,
      now: input.now,
      live: null,
    });
    return {
      id: input.id,
      slot: input.slot,
      name: input.name,
      meta: input.meta,
      game: 'Bye',
      awayTeam: null,
      homeTeam: null,
      network: EMPTY,
      status: label.text,
      statusMuted: label.muted,
      live: false,
      gameId: null,
      deepLinkUrl: null,
      switchLabel: input.name,
    };
  }

  const live =
    input.liveGames.find((candidate) => candidate.game_id === input.game?.game_id) ?? null;
  const inProgress =
    input.game.status === 'in_progress' || (live !== null && input.game.status !== 'final');
  const isFinal = input.game.status === 'final';
  const kickoff = new Date(input.game.scheduled_start);
  const label = watchlistStatusLabel({
    bye: false,
    isFinal,
    inProgress,
    kickoff,
    now: input.now,
    live,
  });

  return {
    id: input.id,
    slot: input.slot,
    name: input.name,
    meta: input.meta,
    game: `${input.game.away_team} @ ${input.game.home_team}`,
    awayTeam: input.game.away_team,
    homeTeam: input.game.home_team,
    network: networkOrDash(input.game),
    status: label.text,
    statusMuted: label.muted,
    live: inProgress && !isFinal,
    gameId: input.game.game_id,
    deepLinkUrl: preferredHttps(input.game),
    switchLabel: `${input.game.away_team} @ ${input.game.home_team}`,
  };
}

function closestGame(
  weekGames: readonly WatchlistTableGame[],
  teamAbbr: string,
  now: Date,
): WatchlistTableGame | null {
  const key = teamAbbr.trim().toUpperCase();
  if (key.length === 0) return null;
  const matches = weekGames.filter(
    (game) => game.home_team.toUpperCase() === key || game.away_team.toUpperCase() === key,
  );
  if (matches.length === 0) return null;
  return matches.reduce((best, candidate) =>
    kickoffDistance(candidate, now) < kickoffDistance(best, now) ? candidate : best,
  );
}

function kickoffDistance(game: WatchlistTableGame, now: Date): number {
  const kickoff = new Date(game.scheduled_start).getTime();
  if (Number.isNaN(kickoff)) return Number.POSITIVE_INFINITY;
  return Math.abs(kickoff - now.getTime());
}

function networkOrDash(game: WatchlistTableGame): string {
  return networkLabelFromAirings(game.airings) ?? EMPTY;
}

function preferredHttps(game: WatchlistTableGame | null): string | null {
  if (!game) return null;
  if (
    game.destination?.kind === 'unavailable' ||
    game.destination?.kind === 'unknown_network' ||
    game.destination?.kind === 'no_broadcast_info'
  ) {
    return null;
  }
  if (game.destination?.kind === 'destinations') return httpsWatchUrl(game.destination.primary.url);
  const preferred = game.broadcasts.find((broadcast) => broadcast.preferred) ?? game.broadcasts[0];
  return httpsWatchUrl(preferred?.deep_link_url);
}
