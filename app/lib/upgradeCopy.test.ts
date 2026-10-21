import { describe, expect, it } from 'vitest';

import {
  PRO_PERKS,
  UPGRADE_HEADLINE,
  UPGRADE_PRICE_FALLBACK,
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

  it('puts the price on the purchase button only', () => {
    expect(UPGRADE_PRICE_FALLBACK).toBe('$9.99/month');
    expect(upgradePurchaseLabel(UPGRADE_PRICE_FALLBACK)).toBe('Upgrade — $9.99/month');
    expect(upgradePurchaseLabel('$4.99/month')).toBe('Upgrade — $4.99/month');
  });
});
