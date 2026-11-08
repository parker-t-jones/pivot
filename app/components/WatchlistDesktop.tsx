import type { ReactNode } from 'react';

import type { FantasyLeagueCardModel } from '../lib/fantasyLeagueCard';

import type { LineupSlot } from '../lib/leagues';
import type { LiveGame, ScheduleGame } from '../lib/schedule';
import type { ManualStake } from '../lib/stakes';
import type { WeekCardModel } from '../lib/weekCardModel';
import type { WatchlistFilter } from '../lib/watchlistFilter';

/**
 * Native stub. The laptop table lives in `WatchlistDesktop.web.tsx`. iOS keeps the phone list
 * because `lineup.tsx` only mounts this when the web tier is medium or wide.
 */
export function WatchlistDesktop(_props: WatchlistDesktopProps): ReactNode {
  return null;
}

export interface WatchlistDesktopProps {
  week: number | null;
  weekCard: WeekCardModel;
  filter: WatchlistFilter;
  onFilter: (key: string) => void;
  onAddStake: () => void;
  starterSlots: readonly LineupSlot[];
  benchSlots: readonly LineupSlot[];
  opponentSlots: readonly LineupSlot[];
  /** False on Bets and Pools. The section is its own card under the user's lineup. */
  showOpponent?: boolean;
  /** Sleeper fantasy team name. The eyebrow stays "OPPONENT". */
  opponentTeamName?: string | null;
  /** Empty copy, or the tracking-off hint. Rendered inside the opponent section. */
  opponentNote?: string | null;
  stakes: readonly ManualStake[];
  pools: readonly ManualStake[];
  weekGames: readonly ScheduleGame[] | null;
  liveGames: readonly LiveGame[];
  now: Date;
  timeZone: string;
  refreshing: boolean;
  onRefresh: () => void;
  topInset: number;
  bottomInset: number;
  onWatchOpponent: (value: boolean) => void;
  /** Deletes the stake. The table hides the row first and calls this when the undo window ends. */
  onRemoveStake: (stake: ManualStake) => void | Promise<void>;
  /** All tab: one collapsible card per fantasy league (issue #14). Empty on other tabs. */
  leagueCards?: readonly { model: FantasyLeagueCardModel; starters: readonly LineupSlot[] }[];
  isLeagueExpanded?: (leagueId: string) => boolean;
  onToggleLeague?: (leagueId: string) => void;
  onSeeFullLineup?: (leagueId: string) => void;
  /** Bets-tab prompt. Null when that tab has 3 or more rows, or the free cap is used up. */
  betPrompt: string | null;
  extras: ReactNode;
  /** Demo account: Add a pick and the opponent toggle stay visible and do not fire. Remove is hidden. */
  editsLocked?: boolean;
}
