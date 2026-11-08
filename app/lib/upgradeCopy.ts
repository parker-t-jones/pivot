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

/**
 * Purchase button label while RevenueCat hasn't returned a store price. Prices only ever come
 * from RevenueCat; never put a hardcoded price in copy.
 */
export const UPGRADE_LABEL_NO_PRICE = 'Upgrade to Pro';

/** Shown when tapping the no-price button retries offerings and they still fail to load. */
export const UPGRADE_PRICING_UNAVAILABLE = "Couldn't load pricing. Try again in a moment.";

export const UPGRADE_PLAN_LABEL = 'Pivot Pro, monthly';

export const UPGRADE_RENEWAL_DISCLOSURE =
  'Renews automatically each month until canceled. Cancel anytime in your Apple ID subscription settings at least 24 hours before renewal.';

export const TERMS_OF_USE_URL = 'https://pivot-sports.app/terms';

export const PRIVACY_POLICY_URL = 'https://pivot-sports.app/privacy';

/** `priceLabel` is RevenueCat's `priceString`, or `null` when no store price has loaded. */
export function upgradePurchaseLabel(priceLabel: string | null): string {
  return priceLabel ? `Upgrade — ${priceLabel}` : UPGRADE_LABEL_NO_PRICE;
}
