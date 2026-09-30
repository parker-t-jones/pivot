import { networkLabelFromAirings } from '@pivot/shared/broadcast';

/**
 * One game from `GET /games?week=` (`fetchGamesWeek`). That payload has no team
 * UUIDs — `home_team` / `away_team` are abbreviations, which is what `teamId`
 * is here (same convention as the Home board's `StakeRef.teamId`).
 */
export interface PlayerWeekGame {
  status: string;
  scheduled_start: string;
  home_team: string;
  away_team: string;
  home_team_primary_color: string;
  away_team_primary_color: string;
  airings: readonly { network: string }[];
}

export type PlayerGame =
  | { kind: 'bye' }
  | {
      kind: 'scheduled' | 'live' | 'final';
      kickoff: Date;
      opponentAbbr: string;
      isHome: boolean;
      network: string | null;
      teamColor: string | null;
    };

/**
 * The player's game this week. `teamId` is the team abbreviation. No matching
 * game (or a blank id) is a bye. `now` picks the closest kickoff when a team
 * appears on more than one game.
 */
export function gameForTeam(
  weekGames: readonly PlayerWeekGame[],
  teamId: string,
  now: Date,
): PlayerGame {
  const key = teamId.trim().toUpperCase();
  if (key.length === 0) return { kind: 'bye' };

  const matches = weekGames.filter((game) => {
    return game.home_team.toUpperCase() === key || game.away_team.toUpperCase() === key;
  });
  if (matches.length === 0) return { kind: 'bye' };

  const game = matches.reduce((best, candidate) => {
    return kickoffDistance(candidate, now) < kickoffDistance(best, now) ? candidate : best;
  });
  const kickoff = new Date(game.scheduled_start);
  if (Number.isNaN(kickoff.getTime())) return { kind: 'bye' };

  const isHome = game.home_team.toUpperCase() === key;
  return {
    kind: kindForStatus(game.status),
    kickoff,
    opponentAbbr: isHome ? game.away_team : game.home_team,
    isHome,
    network: networkLabelFromAirings(game.airings),
    teamColor: colorOrNull(isHome ? game.home_team_primary_color : game.away_team_primary_color),
  };
}

/** Display line for a `gameForTeam` result. Times are in `timeZone`. */
export function formatGameLine(result: PlayerGame, now: Date, timeZone: string): string {
  if (result.kind === 'bye') return 'BYE';
  if (result.kind === 'live') return 'LIVE';
  if (result.kind === 'final') return 'FINAL';

  const when = sameLocalDay(result.kickoff, now, timeZone)
    ? 'TODAY'
    : weekdayLabel(result.kickoff, timeZone);
  const clock = kickoffClock(result.kickoff, timeZone);
  const head = `${when} ${clock}`;
  return result.network ? `${head} · ${result.network}` : head;
}

function kindForStatus(status: string): 'scheduled' | 'live' | 'final' {
  if (status === 'in_progress') return 'live';
  if (status === 'final') return 'final';
  return 'scheduled';
}

function colorOrNull(hex: string): string | null {
  const trimmed = hex.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function kickoffDistance(game: PlayerWeekGame, now: Date): number {
  const kickoff = new Date(game.scheduled_start).getTime();
  if (Number.isNaN(kickoff)) return Number.POSITIVE_INFINITY;
  return Math.abs(kickoff - now.getTime());
}

function sameLocalDay(a: Date, b: Date, timeZone: string): boolean {
  return localDayKey(a, timeZone) === localDayKey(b, timeZone);
}

function localDayKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  return `${year}-${month}-${day}`;
}

function weekdayLabel(date: Date, timeZone: string): string {
  const label = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  return label.replace('.', '').slice(0, 3).toUpperCase();
}

function kickoffClock(date: Date, timeZone: string): string {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
  return formatted.replace(/[\u202f\u00a0]/g, ' ').replace(/\s+/g, ' ');
}
