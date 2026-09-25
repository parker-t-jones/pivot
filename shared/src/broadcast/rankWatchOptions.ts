import type { UserService, WatchOption } from './types.js';

const IN_MARKET_MVPDS = new Set<UserService>([
  'youtube_tv',
  'hulu_live',
  'fubo',
  'directv',
]);

/**
 * Rank expanded watch options against the user's subscribed services (§1.6, §9.3).
 *
 * - Eligible (user has service) before ineligible.
 * - On a regional Sunday CBS/FOX slate: sunday_ticket before any in-market MVPD;
 *   the MVPD stays as option #2 with routeHint `in_market_local`.
 * - Otherwise: ascending lag, then service name.
 * - preferred = first eligible, or none when the user has no matching services.
 */
export function rankWatchOptions(
  options: readonly WatchOption[],
  userServices: ReadonlySet<string>,
  regionalSlate: boolean,
): WatchOption[] {
  const ranked: WatchOption[] = options.map((option) => {
    const { routeHint: _ignored, ...rest } = option;
    return { ...rest, preferred: false };
  });

  const ticketEligible =
    regionalSlate &&
    ranked.some((o) => o.service === 'sunday_ticket' && userServices.has('sunday_ticket'));

  ranked.sort((a, b) => {
    const aEligible = userServices.has(a.service);
    const bEligible = userServices.has(b.service);
    if (aEligible !== bEligible) return aEligible ? -1 : 1;

    if (ticketEligible && aEligible && bEligible) {
      const aTicket = a.service === 'sunday_ticket';
      const bTicket = b.service === 'sunday_ticket';
      const aMvpd = IN_MARKET_MVPDS.has(a.service);
      const bMvpd = IN_MARKET_MVPDS.has(b.service);
      if (aTicket && bMvpd) return -1;
      if (bTicket && aMvpd) return 1;
    }

    const lagDelta = a.typicalLagSeconds - b.typicalLagSeconds;
    if (lagDelta !== 0) return lagDelta;
    return a.service.localeCompare(b.service);
  });

  if (ticketEligible) {
    const preferred = ranked.find((o) => o.service === 'sunday_ticket' && userServices.has(o.service));
    const local = ranked.find(
      (o) => IN_MARKET_MVPDS.has(o.service) && userServices.has(o.service),
    );
    if (preferred && local && preferred !== local) {
      local.routeHint = 'in_market_local';
      const without = ranked.filter((o) => o !== preferred && o !== local);
      const restEligible = without.filter((o) => userServices.has(o.service));
      const restIneligible = without.filter((o) => !userServices.has(o.service));
      ranked.length = 0;
      ranked.push(preferred, local, ...restEligible, ...restIneligible);
    }
  }

  const top = ranked[0];
  if (top && userServices.has(top.service)) {
    top.preferred = true;
  }

  return ranked;
}
