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

export const UPGRADE_PLAN_LABEL = 'Pivot Pro, monthly';

export const UPGRADE_RENEWAL_DISCLOSURE =
  'Renews automatically each month until canceled. Cancel anytime in your Apple ID subscription settings at least 24 hours before renewal.';

export const TERMS_OF_USE_URL = 'https://pivot-sports.app/terms';

export const PRIVACY_POLICY_URL = 'https://pivot-sports.app/privacy';

export function upgradePurchaseLabel(priceLabel: string): string {
  return `Upgrade — ${priceLabel}`;
}
