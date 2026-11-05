/**
 * Web platform split for `purchases.ts`. Metro loads this file instead of the
 * native module, so `react-native-purchases` is never imported or initialized
 * in the web bundle. Pro is purchased in the iOS app.
 */

import { noteLocalEntitlement, noteServerTier } from './subscriptionPlan';

export function isPurchasesConfigured(): boolean {
  return false;
}

export async function configurePurchases(_userId: string): Promise<void> {
  // No-op. RevenueCat stays on iOS.
}

export async function logOutPurchases(): Promise<void> {
  noteServerTier('free');
  noteLocalEntitlement(false);
}
