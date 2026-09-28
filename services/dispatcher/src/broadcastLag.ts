import {
  watchOptionsForGame,
  type ParsedAiring,
  type WatchOption,
  type WeekGameAirings,
} from '@pivot/shared';

/**
 * The switch target for one user and game: the top option from the shared `watchOptionsForGame`
 * ranking (docs/B1-BROADCAST-DESIGN.md §1.6) — the same ranking `GET /games/:id/broadcasts` serves,
 * so the push and the app name the same service. `null` when the user has no service that carries
 * the game.
 */
export function pickBroadcastSource(
  gameId: string,
  week: readonly WeekGameAirings[],
  userServices: ReadonlySet<string>,
): WatchOption | null {
  return watchOptionsForGame(gameId, week, userServices)[0] ?? null;
}

/**
 * Where the dispatcher reads airings and presence. Airings come per week because regional-slate
 * ranking compares a game against the rest of its window.
 */
export interface BroadcastCatalog {
  /** Every game in `gameId`'s week (including it) with its airings; empty for an unknown game. */
  getWeekAirings(gameId: string): Promise<WeekGameAirings[]>;
  getUserSubscribedServices(userId: string): Promise<ReadonlySet<string>>;
}

export interface LikelyBroadcast {
  source: WatchOption | null;
  /** The game's airings, for naming the network when there is no `source` ("On FOX"). */
  airings: readonly ParsedAiring[];
}

/** Section 8's `resolveLikelyBroadcastSource(gameId, user)`, split into ids. */
export async function resolveLikelyBroadcastSource(
  gameId: string,
  userId: string,
  catalog: BroadcastCatalog,
): Promise<LikelyBroadcast> {
  const [week, services] = await Promise.all([
    catalog.getWeekAirings(gameId),
    catalog.getUserSubscribedServices(userId),
  ]);
  return {
    source: pickBroadcastSource(gameId, week, services),
    airings: week.find((game) => game.id === gameId)?.airings ?? [],
  };
}

/** In-memory `BroadcastCatalog` for tests and the harness. `runner/supabaseCatalogs.ts` has the
 *  Postgres one. */
export class InMemoryBroadcastCatalog implements BroadcastCatalog {
  private readonly weekByGame = new Map<string, WeekGameAirings[]>();
  private readonly userServices = new Map<string, Set<string>>();

  async getWeekAirings(gameId: string): Promise<WeekGameAirings[]> {
    return this.weekByGame.get(gameId) ?? [];
  }

  async getUserSubscribedServices(userId: string): Promise<ReadonlySet<string>> {
    return this.userServices.get(userId) ?? new Set();
  }

  /** Registers one week's games; each game's lookup returns the whole list. */
  setWeekAirings(games: WeekGameAirings[]): void {
    for (const game of games) this.weekByGame.set(game.id, games);
  }

  setUserSubscribedServices(userId: string, services: string[]): void {
    this.userServices.set(userId, new Set(services));
  }
}
