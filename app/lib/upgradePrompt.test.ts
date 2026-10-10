import { describe, expect, it } from 'vitest';
import { isUpgradeCapCode, upgradeContextLine } from './upgradeCap';

describe('upgrade cap codes', () => {
  it('matches the free caps that open the paywall, including the weekly bet cap', () => {
    expect(isUpgradeCapCode('league_limit_free')).toBe(true);
    expect(isUpgradeCapCode('manual_lineup_limit_free')).toBe(true);
    expect(isUpgradeCapCode('stake_limit_free')).toBe(true);
    expect(isUpgradeCapCode('watched_league_limit_free')).toBe(false);
    expect(isUpgradeCapCode('stake_line_invalid')).toBe(false);
  });

  it('shows the weekly bet context line only for stake_limit_free', () => {
    expect(upgradeContextLine('stake_limit_free')).toBe("You've tracked 3 bets this week.");
    expect(upgradeContextLine('league_limit_free')).toBeNull();
    expect(upgradeContextLine('manual_lineup_limit_free')).toBeNull();
    expect(upgradeContextLine('watched_league_limit_free')).toBeNull();
    expect(upgradeContextLine(null)).toBeNull();
    expect(upgradeContextLine(undefined)).toBeNull();
  });
});
