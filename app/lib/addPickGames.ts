import { groupWindow, type WindowLabel } from '@pivot/shared/broadcast';

import type { PickKind } from './addPickFlow';
import { isBenchSlot, type BrowsedStarterSlot } from './weekCardModel';

/** `live`: in progress and open to a live bet. `started`: in progress, closed to this kind. */
export type PickGameAvailability = 'open' | 'live' | 'started' | 'final';

export interface PickGameGroup<T> {
  label: WindowLabel;
  games: T[];
}

interface GroupableGame {
  scheduled_start: string;
  away_team: string;
}

/**
 * Home-board windows (`groupWindow`), ordered by the group's earliest kickoff.
 * Inside a window: kickoff, then away abbreviation.
 */
export function groupPickGames<T extends GroupableGame>(games: readonly T[]): PickGameGroup<T>[] {
  const buckets = new Map<WindowLabel, T[]>();
  for (const game of games) {
    const kickoff = new Date(game.scheduled_start);
    if (Number.isNaN(kickoff.getTime())) continue;
    const label = groupWindow(kickoff);
    const list = buckets.get(label) ?? [];
    list.push(game);
    buckets.set(label, list);
  }

  return [...buckets.entries()]
    .flatMap(([label, rows]) => {
      const sorted = rows.slice().sort((a, b) => {
        const byKickoff =
          new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime();
        if (byKickoff !== 0) return byKickoff;
        return a.away_team.localeCompare(b.away_team);
      });
      const first = sorted[0];
      return first
        ? [{ label, games: sorted, earliest: new Date(first.scheduled_start).getTime() }]
        : [];
    })
    .sort((a, b) => a.earliest - b.earliest)
    .map(({ label, games: rows }) => ({ label, games: rows }));
}

/**
 * Started and final stay on the slate. A game in progress is open to a live bet
 * (docs/P2-PICKS-MODEL.md §3) and closed to a survivor pick. A final game is closed.
 */
export function pickGameAvailability(status: string, allowLive: boolean): PickGameAvailability {
  if (status === 'final') return 'final';
  if (status === 'in_progress') return allowLive ? 'live' : 'started';
  return 'open';
}

export function pickGameSelectable(availability: PickGameAvailability): boolean {
  return availability === 'open' || availability === 'live';
}

export function pickGameStatusLabel(availability: PickGameAvailability): string | null {
  if (availability === 'live') return 'Live';
  if (availability === 'started') return 'Started';
  if (availability === 'final') return 'Final';
  return null;
}

/** The player's game this week, matched on the team abbreviation. Null on a bye. */
export function playerGame<T extends { home_team: string; away_team: string }>(
  player: { team: { abbreviation: string } | null },
  games: readonly T[],
): T | null {
  const abbreviation = player.team?.abbreviation.trim().toUpperCase() ?? '';
  if (abbreviation.length === 0) return null;
  return (
    games.find(
      (game) =>
        game.home_team.trim().toUpperCase() === abbreviation ||
        game.away_team.trim().toUpperCase() === abbreviation,
    ) ?? null
  );
}

/** Search-row subtitle for a player prop: position, team, and whether the game is open. */
export function playerResultSubtitle(
  player: { position: string; team: { abbreviation: string } | null },
  game: { status: string; home_team: string; away_team: string } | null,
): { subtitle: string; disabled: boolean } {
  const team = player.team?.abbreviation ?? 'FA';
  const base = `${player.position} · ${team}`;
  if (game === null) return { subtitle: `${base} · No game this week`, disabled: true };
  const availability = pickGameAvailability(game.status, true);
  const matchup = `${game.away_team} @ ${game.home_team}`;
  const status = pickGameStatusLabel(availability);
  return {
    subtitle: [base, matchup, status].filter((part) => part != null).join(' · '),
    disabled: !pickGameSelectable(availability),
  };
}

/** Unique non-bench starters whose team plays in that game. */
export function starterCountsByGame(
  slots: readonly BrowsedStarterSlot[],
  games: readonly { game_id: string; home_team: string; away_team: string }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const game of games) {
    const teams = new Set(
      [game.home_team, game.away_team].map((team) => team.trim().toUpperCase()),
    );
    const seen = new Set<string>();
    for (const slot of slots) {
      if (isBenchSlot(slot)) continue;
      const abbr = slot.player.team?.abbreviation.trim().toUpperCase() ?? '';
      if (!teams.has(abbr) || seen.has(slot.player.player_id)) continue;
      seen.add(slot.player.player_id);
    }
    if (seen.size > 0) counts.set(game.game_id, seen.size);
  }
  return counts;
}

/** Kinds the "Already tracking" note covers. Props and parlays have too many shapes to name. */
const TRACKED_TYPES: Partial<Record<PickKind, readonly string[]>> = {
  SPREAD: ['SPREAD'],
  TOTAL: ['TOTAL_OVER', 'TOTAL_UNDER'],
  MONEYLINE: ['MONEYLINE'],
  SURVIVOR: ['SURVIVOR'],
};

export function gameTracksKind(
  stakes: readonly { game_id: string; condition: { type: string; segment?: string } }[],
  gameId: string,
  kind: PickKind,
): boolean {
  const types = TRACKED_TYPES[kind];
  if (!types) return false;
  return stakes.some(
    (stake) =>
      stake.game_id === gameId &&
      types.includes(stake.condition.type) &&
      stake.condition.segment === undefined,
  );
}

export function alreadyTrackingLabel(kind: PickKind): string | null {
  switch (kind) {
    case 'MONEYLINE':
      return 'Already tracking ML';
    case 'SPREAD':
      return 'Already tracking spread';
    case 'TOTAL':
      return 'Already tracking total';
    case 'SURVIVOR':
      return 'Already tracking survivor';
    default:
      return null;
  }
}

/** Both notes can show. A duplicate stake stays selectable; the API rejects only an exact copy. */
export function pickGameContextLine(
  starterCount: number,
  tracking: boolean,
  kind: PickKind,
): string | null {
  const parts: string[] = [];
  if (starterCount > 0) parts.push(`${starterCount} of your players`);
  const label = tracking ? alreadyTrackingLabel(kind) : null;
  if (label) parts.push(label);
  return parts.length > 0 ? parts.join(' · ') : null;
}
