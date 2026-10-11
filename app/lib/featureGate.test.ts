import { describe, expect, it } from 'vitest';

import { featureEnabled } from './featureGate';

describe('featureEnabled bets', () => {
  it('is on when the dev override is on, even with no server payload', () => {
    expect(featureEnabled('bets', undefined, true)).toBe(true);
    expect(featureEnabled('bets', null, true)).toBe(true);
    expect(featureEnabled('bets', {}, true)).toBe(true);
  });

  it('follows the server value when the override is off', () => {
    expect(featureEnabled('bets', { features: { bets: true } }, false)).toBe(true);
    expect(featureEnabled('bets', { features: { bets: false } }, false)).toBe(false);
  });

  it('is off when the features key is missing', () => {
    expect(featureEnabled('bets', {}, false)).toBe(false);
    expect(featureEnabled('bets', undefined, false)).toBe(false);
    expect(featureEnabled('bets', null, false)).toBe(false);
  });
});
