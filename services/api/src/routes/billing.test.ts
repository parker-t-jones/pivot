import { describe, expect, it } from 'vitest';
import { resolveRevenueCatTier } from './billing.js';

describe('resolveRevenueCatTier', () => {
  it('grants pro on INITIAL_PURCHASE', () => {
    expect(
      resolveRevenueCatTier({
        type: 'INITIAL_PURCHASE',
        app_user_id: 'user-1',
        entitlement_ids: ['pro'],
      }),
    ).toBe('pro');
  });

  it('revokes on EXPIRATION', () => {
    expect(
      resolveRevenueCatTier({
        type: 'EXPIRATION',
        app_user_id: 'user-1',
        entitlement_ids: [],
      }),
    ).toBe('free');
  });

  it('ignores CANCELLATION (access until EXPIRATION)', () => {
    expect(
      resolveRevenueCatTier({
        type: 'CANCELLATION',
        app_user_id: 'user-1',
        entitlement_ids: ['pro'],
      }),
    ).toBeNull();
  });

  it('PRODUCT_CHANGE without pro entitlement revokes', () => {
    expect(
      resolveRevenueCatTier({
        type: 'PRODUCT_CHANGE',
        app_user_id: 'user-1',
        entitlement_ids: ['other'],
      }),
    ).toBe('free');
  });

  it('ignores unknown events without pro entitlement', () => {
    expect(
      resolveRevenueCatTier({
        type: 'SUBSCRIBER_ALIAS',
        app_user_id: 'user-1',
        entitlement_ids: [],
      }),
    ).toBeNull();
  });
});
