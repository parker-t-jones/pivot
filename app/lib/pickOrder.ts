/**
 * Watchlist pick order for All and Bets (issue #14): live games first, then games still to kick
 * off by kickoff, then finals at the bottom. The same rule as Home's YOUR PICKS
 * (`compareMyCardGames` in `board.ts`). Inside a group: kickoff, then game id, then the order the
 * picks came in.
 */

export type PickOrderPhase = 'live' | 'upcoming' | 'final';

export interface OrderablePick {
  game_id: string;
  game: { scheduled_start: string; status: string } | null;
}

export interface OrderWeekGame {
  game_id: string;
  status: string;
  scheduled_start: string;
}

/**
 * Same phase rule as `pickCardModel`: the week schedule's status wins over the stake's embedded
 * game, and a live-feed entry makes a non-final game live.
 */
export function pickPhase(
  pick: OrderablePick,
  weekGames: readonly OrderWeekGame[] | null,
  liveGameIds: ReadonlySet<string>,
): PickOrderPhase {
  const weekGame = weekGames?.find((game) => game.game_id === pick.game_id) ?? null;
  const status = weekGame?.status ?? pick.game?.status ?? 'scheduled';
  if (status === 'final') return 'final';
  if (status === 'in_progress' || liveGameIds.has(pick.game_id)) return 'live';
  return 'upcoming';
}

const RANK: Record<PickOrderPhase, number> = { live: 0, upcoming: 1, final: 2 };

function kickoffMs(pick: OrderablePick, weekGames: readonly OrderWeekGame[] | null): number {
  const weekGame = weekGames?.find((game) => game.game_id === pick.game_id) ?? null;
  const iso = weekGame?.scheduled_start ?? pick.game?.scheduled_start ?? null;
  const ms = iso == null ? Number.NaN : Date.parse(iso);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

export function orderPicks<T extends OrderablePick>(
  picks: readonly T[],
  weekGames: readonly OrderWeekGame[] | null,
  liveGames: readonly { game_id: string }[],
): T[] {
  const liveIds = new Set(liveGames.map((game) => game.game_id));
  const keyed = picks.map((pick, index) => ({
    pick,
    index,
    rank: RANK[pickPhase(pick, weekGames, liveIds)],
    kickoff: kickoffMs(pick, weekGames),
  }));
  keyed.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.kickoff !== b.kickoff) return a.kickoff < b.kickoff ? -1 : 1;
    if (a.pick.game_id !== b.pick.game_id) return a.pick.game_id < b.pick.game_id ? -1 : 1;
    return a.index - b.index;
  });
  return keyed.map((entry) => entry.pick);
}
