export type OpponentSectionState = 'hidden' | 'off' | 'on';

/**
 * Lineup OPPONENT section.
 * `null` / missing opponent (manual league, or no matchup stakes this week) hides it.
 * The switch previews the list only while `watchOpponent` is on.
 */
export function opponentSectionState(
  opponent: { starters: readonly unknown[] } | null | undefined,
  watchOpponent: boolean,
): OpponentSectionState {
  if (opponent == null) return 'hidden';
  return watchOpponent ? 'on' : 'off';
}
