import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  configure: vi.fn(),
  logIn: vi.fn(),
  logOut: vi.fn(),
  getOfferings: vi.fn(),
  purchasePackage: vi.fn(),
  restorePurchases: vi.fn(),
  setLogLevel: vi.fn(),
  fetchMe: vi.fn(),
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

vi.mock('react-native-purchases', () => ({
  default: {
    configure: sdk.configure,
    logIn: sdk.logIn,
    logOut: sdk.logOut,
    getOfferings: sdk.getOfferings,
    purchasePackage: sdk.purchasePackage,
    restorePurchases: sdk.restorePurchases,
    setLogLevel: sdk.setLogLevel,
  },
  LOG_LEVEL: { DEBUG: 'DEBUG' },
}));

vi.mock('./me', () => ({
  fetchMe: sdk.fetchMe,
}));

const proInfo = {
  entitlements: { active: { pro: { identifier: 'pro' } } },
};

async function loadModules() {
  vi.resetModules();
  process.env['EXPO_PUBLIC_REVENUECAT_API_KEY'] = 'test_key';
  const purchases = await import('./purchases');
  const plan = await import('./subscriptionPlan');
  return { purchases, plan };
}

describe('purchases identity and tier refresh', () => {
  beforeEach(() => {
    sdk.configure.mockReset();
    sdk.logIn.mockReset();
    sdk.logOut.mockReset();
    sdk.getOfferings.mockReset();
    sdk.purchasePackage.mockReset();
    sdk.restorePurchases.mockReset();
    sdk.fetchMe.mockReset();
    sdk.logIn.mockResolvedValue({ customerInfo: proInfo, created: false });
    sdk.logOut.mockResolvedValue({ entitlements: { active: {} } });
    sdk.getOfferings.mockResolvedValue({
      current: {
        monthly: null,
        availablePackages: [{ product: { identifier: 'pivot_pro_monthly' } }],
      },
    });
    sdk.purchasePackage.mockResolvedValue({ customerInfo: proInfo });
    sdk.restorePurchases.mockResolvedValue(proInfo);
    sdk.fetchMe.mockResolvedValue({ subscription_tier: 'free' });
  });

  it('calls Purchases.logIn with the Supabase user id and logOut on sign-out', async () => {
    const { purchases } = await loadModules();
    await purchases.configurePurchases('8a259307-026c-4d39-ac59-bd8b1f3c8fea');
    expect(sdk.configure).toHaveBeenCalledWith({ apiKey: 'test_key' });
    expect(sdk.logIn).toHaveBeenCalledWith('8a259307-026c-4d39-ac59-bd8b1f3c8fea');

    await purchases.logOutPurchases();
    expect(sdk.logOut).toHaveBeenCalledTimes(1);
  });

  it('refetches GET /me after purchase and shows Pro from the local entitlement', async () => {
    const { purchases, plan } = await loadModules();
    plan.noteServerTier('free');
    await purchases.purchaseProMonthly();
    expect(sdk.fetchMe).toHaveBeenCalledTimes(1);
    expect(plan.currentSettingsPlanLabel()).toBe('Pro plan');
  });

  it('refetches GET /me after restore and shows Pro from the local entitlement', async () => {
    const { purchases, plan } = await loadModules();
    plan.noteServerTier('free');
    await purchases.restorePurchases();
    expect(sdk.fetchMe).toHaveBeenCalledTimes(1);
    expect(plan.currentSettingsPlanLabel()).toBe('Pro plan');
  });
});
