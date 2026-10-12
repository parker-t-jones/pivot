import type { ReactNode } from 'react';

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
  showOpponentToggle: boolean;
  watchOpponent: boolean;
  onWatchOpponent: (value: boolean) => void;
  onRemoveStake: (stake: ManualStake) => void;
  extras: ReactNode;
}
