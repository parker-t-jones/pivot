import { useCallback, useState } from 'react';

import { isBenchSlot } from './weekCardModel';

/**
 * One collapsed card per fantasy league on the Watchlist's All tab (issue #14), so a full lineup
 * no longer pushes every other pick down. Tapping expands the lineup in place.
 */

export interface FantasyLeagueCardModel {
  leagueId: string;
  /** "FANTASY · SLEEPER". */
  eyebrow: string;
  name: string;
  /** "9 starters · 2 live now", "1 starter", or "No starters yet". */
  summary: string;
}

interface CardSlot {
  slot_type: string;
  position_in_lineup: string;
  player: { team: { abbreviation: string } | null };
}

interface CardWeekGame {
  game_id: string;
  status: string;
  home_team: string;
  away_team: string;
}

function platformLabel(platform: string): string {
  const trimmed = platform.trim();
  return trimmed.length > 0 ? trimmed.toUpperCase() : 'LEAGUE';
}

/** Teams whose game is on right now: the schedule says in progress, or the live feed has it. */
export function liveTeamAbbrs(
  weekGames: readonly CardWeekGame[] | null,
  liveGames: readonly { game_id: string }[],
): Set<string> {
  const liveIds = new Set(liveGames.map((game) => game.game_id));
  const teams = new Set<string>();
  for (const game of weekGames ?? []) {
    if (game.status === 'final') continue;
    if (game.status !== 'in_progress' && !liveIds.has(game.game_id)) continue;
    teams.add(game.home_team.trim().toUpperCase());
    teams.add(game.away_team.trim().toUpperCase());
  }
  return teams;
}

export function fantasyLeagueCardModel(input: {
  league: { league_id: string; platform: string; name: string };
  slots: readonly CardSlot[];
  liveTeams: ReadonlySet<string>;
}): FantasyLeagueCardModel {
  const starters = input.slots.filter((slot) => !isBenchSlot(slot));
  const live = starters.filter((slot) => {
    const abbr = slot.player.team?.abbreviation.trim().toUpperCase() ?? '';
    return abbr.length > 0 && input.liveTeams.has(abbr);
  }).length;
  const count =
    starters.length === 0
      ? 'No starters yet'
      : `${starters.length} ${starters.length === 1 ? 'starter' : 'starters'}`;
  return {
    leagueId: input.league.league_id,
    eyebrow: `FANTASY · ${platformLabel(input.league.platform)}`,
    name: input.league.name,
    summary: live > 0 ? `${count} · ${live} live now` : count,
  };
}

/**
 * Leagues the All tab shows: the watched leagues, or every league when none is picked (the same
 * rule as the week card's watched-starter count). Keeps the order of `leagues`.
 */
export function allTabLeagues<T extends { league_id: string }>(
  leagues: readonly T[],
  watchedLeagueIds: readonly string[],
): T[] {
  if (watchedLeagueIds.length === 0) return [...leagues];
  return leagues.filter((league) => watchedLeagueIds.includes(league.league_id));
}

/**
 * Expanded leagues for this JS session, like the Watchlist filter pill: survives tab switches and
 * resets on a cold start. Not AsyncStorage.
 */
const expandedLeagues = new Set<string>();

export function isLeagueExpanded(leagueId: string): boolean {
  return expandedLeagues.has(leagueId);
}

export function setLeagueExpanded(leagueId: string, expanded: boolean): void {
  if (expanded) expandedLeagues.add(leagueId);
  else expandedLeagues.delete(leagueId);
}

export function resetLeagueExpansionForTests(): void {
  expandedLeagues.clear();
}

/** Re-renders on toggle. The remembered set is the source of truth. */
export function useLeagueExpansion(): {
  isExpanded: (leagueId: string) => boolean;
  toggle: (leagueId: string) => void;
} {
  const [, setRevision] = useState(0);
  const toggle = useCallback((leagueId: string) => {
    setLeagueExpanded(leagueId, !expandedLeagues.has(leagueId));
    setRevision((value) => value + 1);
  }, []);
  return { isExpanded: isLeagueExpanded, toggle };
}
