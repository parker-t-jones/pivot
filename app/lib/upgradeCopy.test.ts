import { describe, expect, it } from 'vitest';

import {
  PRO_PERKS,
  UPGRADE_HEADLINE,
  UPGRADE_LABEL_NO_PRICE,
  UPGRADE_PRICING_UNAVAILABLE,
  UPGRADE_SUBTITLE,
  upgradePurchaseLabel,
} from './upgradeCopy';

describe('upgrade copy', () => {
  it('speaks to every pick, and drops the survivor aside', () => {
    expect(UPGRADE_HEADLINE).toBe('Every pick. Every play.');
    expect(UPGRADE_SUBTITLE).toBe(
      'Free covers 3 leagues, 1 Active Lineup, and 3 bets a week. Pro removes the caps.',
    );
    expect(UPGRADE_SUBTITLE).not.toContain('Survivor');
  });

  it('lists sentence-case perks with bets first', () => {
    expect([...PRO_PERKS]).toEqual([
      'Unlimited bets each week',
      'Unlimited connected leagues',
      'Watch multiple Active Lineups at once',
      'Unlimited manual lineup players',
    ]);
    for (const perk of PRO_PERKS) {
      expect(perk[0]).toBe(perk[0]?.toUpperCase());
    }
  });

  it('puts the RevenueCat price on the purchase button', () => {
    expect(upgradePurchaseLabel('$4.99')).toBe('Upgrade — $4.99');
    expect(upgradePurchaseLabel('£4.49')).toBe('Upgrade — £4.49');
  });

  it('drops the price, rather than guessing one, when RevenueCat has none', () => {
    expect(UPGRADE_LABEL_NO_PRICE).toBe('Upgrade to Pro');
    expect(upgradePurchaseLabel(null)).toBe('Upgrade to Pro');
    expect(upgradePurchaseLabel('')).toBe('Upgrade to Pro');
    expect(UPGRADE_PRICING_UNAVAILABLE).toBe("Couldn't load pricing. Try again in a moment.");
  });
});
