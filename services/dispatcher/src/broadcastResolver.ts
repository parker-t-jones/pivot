import { lagSecondsFor, type BroadcastCatalog, type GameBroadcastOption } from './broadcastLag.js';

/**
 * PLAN.md Section 2's `BroadcastResolver` — authoritative deep-link resolution: given a game's
 * broadcasts and the user's app presence, produce the fully-ranked, annotated list the Section 9
 * `GET /games/:id/broadcasts` response specs, with exactly one `preferred` entry.
 *
 * Deliberately INDEPENDENT of `pickBroadcastSource` (`broadcastLag.ts`), per the Sprint 7 Phase 2
 * decision (option b). The two rankers optimize genuinely different things over different candidate
 * sets:
 *  - `pickBroadcastSource` (timing) ranks *subscribed-only* services by lowest lag and returns one
 *    service string, feeding `scheduleFlagEvent`'s fire-time offset — free/unsubscribed broadcasts
 *    are irrelevant to when *this user's* stream shows the play.
 *  - `rankBroadcasts` (here) ranks *all* broadcasts by eligibility-then-tiebreak and returns the full
 *    annotated list including ineligible ones — the endpoint surfaces every option.
 * The only thing they legitimately share is the lag lookup, and `lagSecondsFor` is already a
 * standalone exported primitive; it's reused here for both `typicalLagSeconds` and the tiebreak, so
 * `pickBroadcastSource` is left untouched.
 */
export interface RankedBroadcast {
  service: string;
  deepLinkUrl: string;
  requiresSubscription: boolean;
  userHasSubscription: boolean;
  typicalLagSeconds: number;
  preferred: boolean;
}

/** Section 9's eligibility rule: a broadcast is watchable if it needs no subscription, or the user has one. */
function isEligible(b: Pick<RankedBroadcast, 'requiresSubscription' | 'userHasSubscription'>): boolean {
  return !b.requiresSubscription || b.userHasSubscription;
}

/**
 * Pure ranking (Section 9 `GET /games/:id/broadcasts`). Ordering is deterministic: eligible broadcasts
 * before ineligible ones; within each group, ascending `typicalLagSeconds` (via `lagSecondsFor`), then
 * alphabetical by `service` as a final tiebreak so the result is independent of input row order.
 *
 * Tiebreak justification: lowest lag = the user sees the play soonest, consistent with the app's
 * lag-aware design and with `pickBroadcastSource`'s own tiebreak — so `preferred` agrees with the
 * timing source whenever the user is subscribed to the lowest-lag service, without any code coupling.
 *
 * `preferred` is set on exactly the first entry IFF it's eligible (i.e. at least one eligible
 * broadcast exists). Empty input, or a game whose every broadcast is ineligible for this user, yields
 * no `preferred` — callers degrade to a null recommendation.
 */
export function rankBroadcasts(
  broadcasts: readonly GameBroadcastOption[],
  userServices: ReadonlySet<string>,
): RankedBroadcast[] {
  const ranked: RankedBroadcast[] = broadcasts.map((b) => ({
    service: b.service,
    deepLinkUrl: b.deepLinkUrl,
    requiresSubscription: b.requiresSubscription,
    userHasSubscription: userServices.has(b.service),
    typicalLagSeconds: lagSecondsFor(b.service),
    preferred: false,
  }));

  ranked.sort((a, b) => {
    const aEligible = isEligible(a);
    const bEligible = isEligible(b);
    if (aEligible !== bEligible) return aEligible ? -1 : 1;
    const lagDelta = a.typicalLagSeconds - b.typicalLagSeconds;
    return lagDelta !== 0 ? lagDelta : a.service.localeCompare(b.service);
  });

  const top = ranked[0];
  if (top && isEligible(top)) {
    top.preferred = true;
  }

  return ranked;
}

/** The single `preferred` broadcast, or `null` when none is eligible. */
export function preferredBroadcast(ranked: readonly RankedBroadcast[]): RankedBroadcast | null {
  return ranked.find((b) => b.preferred) ?? null;
}

/**
 * I/O wrapper mirroring `resolveLikelyBroadcastSource`'s shape — reuses the same `BroadcastCatalog`
 * (`getUserSubscribedServices` returns the set of services the user has an active subscription to,
 * i.e. `user_app_presence.has_subscription = true`).
 */
export async function resolveBroadcasts(
  gameId: string,
  userId: string,
  catalog: BroadcastCatalog,
): Promise<RankedBroadcast[]> {
  const [broadcasts, userServices] = await Promise.all([
    catalog.getGameBroadcasts(gameId),
    catalog.getUserSubscribedServices(userId),
  ]);
  return rankBroadcasts(broadcasts, userServices);
}
