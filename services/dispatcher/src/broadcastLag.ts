/** PLAN.md Section 8 "Deferred event scheduling" — verbatim. */
export const BROADCAST_LAG_SECONDS: Record<string, number> = {
  sunday_ticket: 75,
  espn_plus: 60,
  paramount_plus: 50,
  peacock: 45,
  amazon_prime: 40,
  nfl_plus: 60,
  nfl_network: 20,
  fox: 8,
  cbs: 8,
  nbc: 8,
  abc: 8,
};

/** Section 8's `BROADCAST_LAG_SECONDS[broadcastSource] ?? 60` fallback for an unresolved/unknown source. */
export const DEFAULT_LAG_SECONDS = 60;

export function lagSecondsFor(service: string | null): number {
  if (service === null) return DEFAULT_LAG_SECONDS;
  return BROADCAST_LAG_SECONDS[service] ?? DEFAULT_LAG_SECONDS;
}

export interface GameBroadcastOption {
  service: string;
  deepLinkUrl: string;
  requiresSubscription: boolean;
}

/**
 * Pure tie-break (sprint decision #6): intersect the game's broadcasts with the user's subscribed
 * services. Among matches, deterministically prefer the one with the LOWEST configured stream lag
 * (`BROADCAST_LAG_SECONDS`) — this naturally prefers broadcast TV (fox/cbs/nbc/abc = 8s, nfl_network
 * = 20s) over paid streaming (40-75s) without inventing a separate priority table divorced from the
 * one Section 8 already gives us. Ties on lag (shouldn't occur with the given table, but kept
 * deterministic) break alphabetically by service name. Returns `null` if no candidate matches (falls
 * back to `DEFAULT_LAG_SECONDS` via `lagSecondsFor(null)`).
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
