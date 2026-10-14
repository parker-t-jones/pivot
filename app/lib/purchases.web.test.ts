import { describe, expect, it } from 'vitest';

import { configurePurchases, isPurchasesConfigured } from './purchases.web';

describe('web purchases', () => {
  it('stays unconfigured even when the RevenueCat key is set', async () => {
    const previous = process.env['EXPO_PUBLIC_REVENUECAT_API_KEY'];
    process.env['EXPO_PUBLIC_REVENUECAT_API_KEY'] = 'appl_test_key';
    try {
      expect(isPurchasesConfigured()).toBe(false);
      await expect(configurePurchases('user-1')).resolves.toBeUndefined();
    } finally {
      if (previous === undefined) {
        Reflect.deleteProperty(process.env, 'EXPO_PUBLIC_REVENUECAT_API_KEY');
      } else {
        process.env['EXPO_PUBLIC_REVENUECAT_API_KEY'] = previous;
      }
    }
  });
});
