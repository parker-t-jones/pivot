import { expandWatchOptions } from './expandWatchOptions.js';
import { isRegionalSlate } from './isRegionalSlate.js';
import { rankWatchOptions } from './rankWatchOptions.js';
import type { ParsedAiring, SlateGame, WatchOption } from './types.js';

/** One game of a week and what airs it — enough to rank its watch options (§1.6). */
export interface WeekGameAirings {
  id: string;
  kickoff: Date;
  airings: readonly ParsedAiring[];
}

export function toSlateGame(game: WeekGameAirings): SlateGame {
  return { id: game.id, kickoff: game.kickoff, networks: game.airings.map((a) => a.network) };
}

/**
 * A user's watch options for one game (§1.6): its airings expanded through carriage and ranked,
 * keeping only services the user has, best first. `week` is every game in the same week, which
 * regional-slate detection needs. Empty when the game isn't in `week` or the user has none of its
 * services. The API's games routes and the dispatcher both rank through here.
 */
export function watchOptionsForGame(
  gameId: string,
  week: readonly WeekGameAirings[],
  userServices: ReadonlySet<string>,
): WatchOption[] {
  const game = week.find((g) => g.id === gameId);
  if (!game) return [];
  const regional = isRegionalSlate(toSlateGame(game), week.map(toSlateGame));
  return rankWatchOptions(
    expandWatchOptions(game.airings, game.kickoff, regional),
    userServices,
    regional,
  ).filter((option) => userServices.has(option.service));
}
