import { groupWindow, type WindowLabel } from '@pivot/shared/broadcast';

import type { PickKind } from './addPickFlow';
import { isBenchSlot, type BrowsedStarterSlot } from './weekCardModel';

export type PickGameAvailability = 'open' | 'started' | 'final';

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

/** Started and final stay on the slate, but they are not tappable. */
export function pickGameAvailability(status: string): PickGameAvailability {
  if (status === 'final') return 'final';
  if (status === 'in_progress') return 'started';
  return 'open';
}

export function pickGameStatusLabel(availability: PickGameAvailability): string | null {
  if (availability === 'started') return 'Started';
  if (availability === 'final') return 'Final';
  return null;
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

function sameKind(type: string, kind: PickKind): boolean {
  if (kind === 'TOTAL') return type === 'TOTAL_OVER' || type === 'TOTAL_UNDER';
  return type === kind;
}

export function gameTracksKind(
  stakes: readonly { game_id: string; condition: { type: string } }[],
  gameId: string,
  kind: PickKind,
): boolean {
  return stakes.some((stake) => stake.game_id === gameId && sameKind(stake.condition.type, kind));
}

export function alreadyTrackingLabel(kind: PickKind): string {
  switch (kind) {
    case 'MONEYLINE':
      return 'Already tracking ML';
    case 'SPREAD':
      return 'Already tracking spread';
    case 'TOTAL':
      return 'Already tracking total';
    case 'SURVIVOR':
      return 'Already tracking survivor';
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
  if (tracking) parts.push(alreadyTrackingLabel(kind));
  return parts.length > 0 ? parts.join(' · ') : null;
}
