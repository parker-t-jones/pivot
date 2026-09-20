import { Platform } from 'react-native';
import Purchases, {
  LOG_LEVEL,
  type CustomerInfo,
  type PurchasesPackage,
} from 'react-native-purchases';

/** RevenueCat entitlement id — must match the dashboard. */
export const PRO_ENTITLEMENT_ID = 'pro';

/** App Store product id — must match App Store Connect + RevenueCat. */
export const PRO_MONTHLY_PRODUCT_ID = 'pivot_pro_monthly';

const API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY;

let configuredForUserId: string | null = null;

export function isPurchasesConfigured(): boolean {
  return typeof API_KEY === 'string' && API_KEY.length > 0;
}

/**
 * Identify the RevenueCat subscriber with the Supabase user id so the webhook
 * can update `users.subscription_tier` for the same id.
 */
export async function configurePurchases(userId: string): Promise<void> {
  if (!isPurchasesConfigured() || Platform.OS !== 'ios') {
    return;
  }
  if (configuredForUserId === userId) {
    return;
  }

  if (__DEV__) {
    Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  }

  Purchases.configure({ apiKey: API_KEY!, appUserID: userId });
  configuredForUserId = userId;
}

export async function getProMonthlyPackage(): Promise<PurchasesPackage | null> {
  if (!isPurchasesConfigured()) return null;
  const offerings = await Purchases.getOfferings();
  const current = offerings.current;
  if (!current) return null;

  const monthly =
    current.availablePackages.find((pkg) => pkg.product.identifier === PRO_MONTHLY_PRODUCT_ID) ??
    current.monthly ??
    current.availablePackages[0] ??
    null;
  return monthly;
}

export function customerHasPro(info: CustomerInfo): boolean {
  return Boolean(info.entitlements.active[PRO_ENTITLEMENT_ID]);
}

export async function purchaseProMonthly(): Promise<CustomerInfo> {
  const pkg = await getProMonthlyPackage();
  if (!pkg) {
    throw new Error('Pro subscription is not available right now.');
  }
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return customerInfo;
}

export async function restorePurchases(): Promise<CustomerInfo> {
  return await Purchases.restorePurchases();
}
