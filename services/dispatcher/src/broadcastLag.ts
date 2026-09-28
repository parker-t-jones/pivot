import { lagSecondsFor } from '@pivot/shared';

export interface GameBroadcastOption {
  service: string;
  deepLinkUrl: string;
  requiresSubscription: boolean;
}

/**
 * Pure tie-break (sprint decision #6): intersect the game's broadcasts with the user's subscribed
 * services. Among matches, deterministically prefer the one with the LOWEST configured stream lag
 * (the shared `USER_SERVICE_LAG_SECONDS`). Since B1.3 broadcasts are airing networks and presence holds user
 * services, so only keys on both lists (amazon_prime, peacock, paramount_plus, espn_plus, nfl_plus)
 * can match until B1.4 expands carriage. Ties on lag break alphabetically by service name. Returns `null` if no candidate matches (falls
 * back to the shared `DEFAULT_LAG_SECONDS` via `lagSecondsFor(null)`).
 */
export function pickBroadcastSource(
  gameBroadcasts: readonly GameBroadcastOption[],
  userServices: ReadonlySet<string>,
): string | null {
  const candidates = [
    ...new Set(gameBroadcasts.map((b) => b.service).filter((s) => userServices.has(s))),
  ];
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const lagDelta = lagSecondsFor(a) - lagSecondsFor(b);
    return lagDelta !== 0 ? lagDelta : a.localeCompare(b);
  });
  return candidates[0] ?? null;
}

/**
 * I/O wrapper matching Section 8's `resolveLikelyBroadcastSource(gameId, user)` signature (here split
 * into `gameId`/`userId` since the pure lookup only needs ids, not a full `User` object).
 */
export interface BroadcastCatalog {
  getGameBroadcasts(gameId: string): Promise<GameBroadcastOption[]>;
  getUserSubscribedServices(userId: string): Promise<ReadonlySet<string>>;
}

export async function resolveLikelyBroadcastSource(
  gameId: string,
  userId: string,
  catalog: BroadcastCatalog,
): Promise<string | null> {
  const [broadcasts, services] = await Promise.all([
    catalog.getGameBroadcasts(gameId),
    catalog.getUserSubscribedServices(userId),
  ]);
  return pickBroadcastSource(broadcasts, services);
}

/** In-memory `BroadcastCatalog` for local dev and tests (Postgres-backed adapter lands when `/games`
 * routes are wired against `game_broadcasts`/`user_app_presence` — both tables already exist from
 * earlier sprints, but there's no reason to write that adapter before it has a caller). */
export class InMemoryBroadcastCatalog implements BroadcastCatalog {
  private readonly broadcasts = new Map<string, GameBroadcastOption[]>();
  private readonly userServices = new Map<string, Set<string>>();

  async getGameBroadcasts(gameId: string): Promise<GameBroadcastOption[]> {
    return this.broadcasts.get(gameId) ?? [];
  }

  async getUserSubscribedServices(userId: string): Promise<ReadonlySet<string>> {
    return this.userServices.get(userId) ?? new Set();
  }

  setGameBroadcasts(gameId: string, options: GameBroadcastOption[]): void {
    this.broadcasts.set(gameId, options);
  }

  setUserSubscribedServices(userId: string, services: string[]): void {
    this.userServices.set(userId, new Set(services));
  }
}
