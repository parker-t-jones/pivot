export type OpponentSectionState = 'hidden' | 'off' | 'on' | 'empty';

/**
 * Lineup OPPONENT section.
 * A Sleeper week with tracking on and no stored opponent is `empty` (bye, or not synced).
 * A fixture opponent on a non-Sleeper league is shown anyway.
 * Otherwise the switch previews the list only while `watchOpponent` is on.
 */
export function opponentSectionState(
  opponent: { starters: readonly unknown[] } | null | undefined,
  watchOpponent: boolean,
  fixture = false,
): OpponentSectionState {
  if (opponent == null) return watchOpponent ? 'empty' : 'hidden';
  if (fixture) return 'on';
  return watchOpponent ? 'on' : 'off';
}

/** Synced week with no pairing is a bye. A lineup that has never synced is still loading. */
export function opponentEmptyCopy(
  lastSyncedAt: string | null | undefined,
): 'No opponent this week' | 'Syncing your matchup…' {
  return lastSyncedAt ? 'No opponent this week' : 'Syncing your matchup…';
}

/** Watchlist section header. Falls back to the eyebrow when Sleeper had no team name. */
export function opponentHeader(teamName: string | null | undefined): string {
  const name = teamName?.trim();
  return name ? `vs. ${name}` : 'OPPONENT';
}
