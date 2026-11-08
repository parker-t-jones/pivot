import type { PickProgress, SettledResult, SlipSummary } from '@pivot/shared';

/**
 * A parlay's status from its legs (docs/P2-PICKS-MODEL.md §2). Lost once any leg has lost or
 * missed. Tie and void legs drop out. Won when every remaining leg has won. All refunded is void.
 * A leg with no stats match (`unavailable`) keeps the slip open: it is never guessed.
 */
export function slipSummary(legs: readonly PickProgress[]): SlipSummary {
  let hit = 0;
  let alive = 0;
  let lost = 0;
  let refunded = 0;
  let won = 0;
  let started = false;
  for (const leg of legs) {
    if (leg.status !== 'pending') started = true;
    switch (leg.status) {
      case 'won':
        won += 1;
        hit += 1;
        break;
      case 'hit':
        hit += 1;
        break;
      case 'lost':
      case 'missed':
        lost += 1;
        break;
      case 'tie':
      case 'void':
        refunded += 1;
        break;
      default:
        alive += 1;
    }
  }
  const counts = { legs: legs.length, hit, alive, lost, refunded };
  if (lost > 0) return { status: 'lost', ...counts };
  if (legs.length > 0 && refunded === legs.length) return { status: 'void', ...counts };
  if (legs.length > 0 && won + refunded === legs.length) return { status: 'won', ...counts };
  return { status: started ? 'live' : 'pending', ...counts };
}

/** The final result to store for a pick or slip, or null while it can still change. */
export function settledResult(
  status: PickProgress['status'] | SlipSummary['status'],
): SettledResult | null {
  return status === 'won' || status === 'lost' || status === 'tie' || status === 'void'
    ? status
    : null;
}
