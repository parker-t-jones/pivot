import { networkLabelFromAirings } from '@pivot/shared/broadcast';

import { compactScoreLabel, liveClockLabel } from './gameDisplay';
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
  /** Opponent, then a live score or a kickoff. */
  game: string;
  network: string;
  status: string;
  live: boolean;
  gameId: string | null;
  /** https watch URL, or null when this row has nothing a browser can open. */
  deepLinkUrl: string | null;
  /** Matchup passed to the switch overlay. */
  switchLabel: string;
}

const EMPTY = '\u2014';

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
  const side = matchupSide(game, input.matchup);
  return {
    id: input.id,
    slot: input.slot,
    name: input.name,
    meta: input.meta,
    game: gameLine(side || input.matchup || EMPTY, inProgress, status === 'final', live, input.kickoff),
    network: game ? networkOrDash(game) : EMPTY,
    status: statusLabel(inProgress, status === 'final', false, live),
    live: inProgress && status !== 'final',
    gameId: game?.game_id ?? (inProgress ? input.gameId : input.gameId),
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
    return {
      id: input.id,
      slot: input.slot,
      name: input.name,
      meta: input.meta,
      game: 'Bye',
      network: EMPTY,
      status: 'BYE',
      live: false,
      gameId: null,
      deepLinkUrl: null,
      switchLabel: input.name,
    };
  }

  const team = input.teamAbbr.trim().toUpperCase();
  const isHome = input.game.home_team.toUpperCase() === team;
  const opponent = isHome ? input.game.away_team : input.game.home_team;
  const side = `${isHome ? 'vs' : '@'} ${opponent}`;
  const live = input.liveGames.find((candidate) => candidate.game_id === input.game?.game_id) ?? null;
  const inProgress = input.game.status === 'in_progress' || (live !== null && input.game.status !== 'final');
  const isFinal = input.game.status === 'final';
  const kickoff = kickoffLabel(input.game.scheduled_start, input.now, input.timeZone);

  return {
    id: input.id,
    slot: input.slot,
    name: input.name,
    meta: input.meta,
    game: gameLine(side, inProgress, isFinal, live, kickoff),
    network: networkOrDash(input.game),
    status: statusLabel(inProgress, isFinal, false, live),
    live: inProgress && !isFinal,
    gameId: input.game.game_id,
    deepLinkUrl: preferredHttps(input.game),
    switchLabel: `${input.game.away_team} @ ${input.game.home_team}`,
  };
}

function gameLine(
  side: string,
  inProgress: boolean,
  isFinal: boolean,
  live: WatchlistTableLive | null,
  kickoff: string,
): string {
  if (inProgress && !isFinal && live) return `${side} · ${compactScoreLabel(live.score)}`;
  if (inProgress && !isFinal) return side;
  if (!isFinal && kickoff.length > 0) return `${side} · ${kickoff}`;
  return side;
}

function statusLabel(
  inProgress: boolean,
  isFinal: boolean,
  bye: boolean,
  live: WatchlistTableLive | null,
): string {
  if (bye) return 'BYE';
  if (isFinal) return 'FINAL';
  if (inProgress) {
    if (!live) return 'LIVE';
    return liveClockLabel(live.quarter, live.time_remaining_sec);
  }
  return 'Upcoming';
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

function kickoffLabel(iso: string, now: Date, timeZone: string): string {
  const kickoff = new Date(iso);
  if (Number.isNaN(kickoff.getTime())) return '';
  const day = sameLocalDay(kickoff, now, timeZone)
    ? 'Today'
    : new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(kickoff);
  const clock = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(kickoff);
  return `${day} ${clock}`;
}

function sameLocalDay(a: Date, b: Date, timeZone: string): boolean {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return format.format(a) === format.format(b);
}

function networkOrDash(game: WatchlistTableGame): string {
  return networkLabelFromAirings(game.airings) ?? EMPTY;
}

function preferredHttps(game: WatchlistTableGame | null): string | null {
  if (!game) return null;
  const preferred = game.broadcasts.find((broadcast) => broadcast.preferred) ?? game.broadcasts[0];
  return httpsWatchUrl(preferred?.deep_link_url);
}

function matchupSide(game: WatchlistTableGame | null, matchup: string): string {
  if (!game) return matchup;
  return `${game.away_team} @ ${game.home_team}`;
}
