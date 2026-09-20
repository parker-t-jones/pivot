import { UpcomingStakeGameList } from './UpcomingStakeGameList';
import type { LineupGameGroup } from '../lib/homeState';

interface HomeOffDayCardProps {
  /** All non-final stake games this week, chronological by kickoff. */
  upcomingGames: LineupGameGroup[];
  week: number;
}

/**
 * PLAN.md Section 10 Home State 4 — in-season upcoming-games slate.
 */
export function HomeOffDayCard({ upcomingGames, week }: HomeOffDayCardProps) {
  return (
    <UpcomingStakeGameList
      games={upcomingGames}
      heading={`WEEK ${week} — Upcoming games:`}
    />
  );
}
