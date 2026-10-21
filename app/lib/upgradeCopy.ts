export const UPGRADE_CARD_WIDTH = 560;

export const UPGRADE_HEADLINE = 'Every pick. Every play.';

export const UPGRADE_SUBTITLE =
  'Free covers 3 leagues, 1 Active Lineup, and 3 bets a week. Pro removes the caps.';

export const PRO_PERKS = [
  'Unlimited bets each week',
  'Unlimited connected leagues',
  'Watch multiple Active Lineups at once',
  'Unlimited manual lineup players',
] as const;

/** Shown until RevenueCat returns a store price. */
export const UPGRADE_PRICE_FALLBACK = '$9.99/month';

export function upgradePurchaseLabel(priceLabel: string): string {
  return `Upgrade — ${priceLabel}`;
}
