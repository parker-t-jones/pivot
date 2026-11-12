// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UpgradeSheet } from './UpgradeSheet';
import { SettingsSubscription } from './SettingsSubscription';
import { fetchMe } from '../lib/me';
import {
  ACTIVATION_WINDOW_MS,
  clearActivation,
  noteLocalEntitlement,
  noteServerTier,
  startActivation,
} from '../lib/subscriptionPlan';
import {
  PRIVACY_POLICY_URL,
  TERMS_OF_USE_URL,
  UPGRADE_LABEL_NO_PRICE,
  UPGRADE_PRICING_UNAVAILABLE,
  UPGRADE_RENEWAL_DISCLOSURE,
} from '../lib/upgradeCopy';

const purchases = vi.hoisted(() => ({
  getProMonthlyPackage: vi.fn<() => Promise<{ product: { priceString: string } } | null>>(),
  purchaseProMonthly: vi.fn(),
}));

vi.mock('react-native', () => import('react-native-web'));

vi.mock('../lib/fonts', () => ({
  fonts: {
    teamNickname: 'sans',
    sansBold: 'sans',
    sansSemiBold: 'sans',
    monoBold: 'mono',
    monoSemiBold: 'mono',
    monoMedium: 'mono',
  },
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('../contexts/UpgradeSheetContext', () => ({
  useUpgradeSheet: () => ({
    isOpen: true,
    code: null,
    closeUpgrade: () => undefined,
    openUpgrade: () => undefined,
  }),
}));

vi.mock('../contexts/SessionContext', () => ({
  useSession: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('../lib/confirm', () => ({
  alertAsync: vi.fn(),
}));

vi.mock('../lib/me', () => ({
  fetchMe: vi.fn(async () => {
    const { noteServerTier } = await import('../lib/subscriptionPlan');
    noteServerTier('free');
    return { subscription_tier: 'free' };
  }),
}));

vi.mock('../lib/purchases', () => ({
  configurePurchases: vi.fn(async () => undefined),
  customerHasPro: () => false,
  getProMonthlyPackage: purchases.getProMonthlyPackage,
  isPurchasesConfigured: () => true,
  purchaseProMonthly: purchases.purchaseProMonthly,
  restorePurchases: vi.fn(),
}));

/** Lets pending promise chains (configure → /me → offerings) settle inside act. */
async function flush(times = 20): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function purchaseButton(): HTMLElement {
  const buttons = Array.from(document.body.querySelectorAll('[role="button"]'));
  const button = buttons.find((el) => el.textContent?.startsWith('Upgrade'));
  if (!(button instanceof HTMLElement)) throw new Error('missing purchase button');
  return button;
}

async function tap(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}

describe('UpgradeSheet purchase disclosures', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    clearActivation();
    noteServerTier('free');
    noteLocalEntitlement(false);
    vi.mocked(fetchMe).mockImplementation(async () => {
      noteServerTier('free');
      return { subscription_tier: 'free' } as Awaited<ReturnType<typeof fetchMe>>;
    });
    purchases.getProMonthlyPackage.mockReset();
    purchases.purchaseProMonthly.mockReset();
    purchases.getProMonthlyPackage.mockResolvedValue({ product: { priceString: '$4.99' } });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    clearActivation();
    vi.useRealTimers();
  });

  it('shows the store price, renewal text, both legal links, and Restore purchases', async () => {
    await act(async () => {
      root.render(<UpgradeSheet />);
    });
    for (let i = 0; i < 20 && !document.body.textContent?.includes('$4.99'); i += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    const text = document.body.textContent ?? '';
    expect(text).toContain('Pivot Pro, monthly');
    expect(text).toContain('$4.99');
    expect(text).toContain(UPGRADE_RENEWAL_DISCLOSURE);
    expect(text).toContain('Terms of Use');
    expect(text).toContain('Privacy Policy');
    expect(text).toContain('Restore purchases');
    expect(document.body.querySelector(`[data-testid="${TERMS_OF_USE_URL}"]`)).not.toBeNull();
    expect(document.body.querySelector(`[data-testid="${PRIVACY_POLICY_URL}"]`)).not.toBeNull();
    expect(purchaseButton().textContent).toBe('Upgrade — $4.99');
  });

  it('shows no price when offerings fail, and a tap retries instead of buying', async () => {
    purchases.getProMonthlyPackage.mockRejectedValue(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await act(async () => {
      root.render(<UpgradeSheet />);
    });
    await flush();

    expect(purchaseButton().textContent).toBe(UPGRADE_LABEL_NO_PRICE);
    expect(document.body.textContent).not.toMatch(/\$\d/);
    expect(document.body.textContent).not.toContain(UPGRADE_PRICING_UNAVAILABLE);
    expect(purchases.getProMonthlyPackage).toHaveBeenCalledTimes(1);

    await tap(purchaseButton());

    expect(purchases.getProMonthlyPackage).toHaveBeenCalledTimes(2);
    expect(purchases.purchaseProMonthly).not.toHaveBeenCalled();
    expect(purchaseButton().textContent).toBe(UPGRADE_LABEL_NO_PRICE);
    expect(document.body.textContent).toContain(UPGRADE_PRICING_UNAVAILABLE);
    warn.mockRestore();
  });

  it('treats an offering with no price string as no price', async () => {
    purchases.getProMonthlyPackage.mockResolvedValue(null);
    await act(async () => {
      root.render(<UpgradeSheet />);
    });
    await flush();

    expect(purchaseButton().textContent).toBe(UPGRADE_LABEL_NO_PRICE);
    await tap(purchaseButton());
    expect(purchases.purchaseProMonthly).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(UPGRADE_PRICING_UNAVAILABLE);
  });

  it('shows the store price after a successful retry, and buys only on the next tap', async () => {
    purchases.getProMonthlyPackage
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ product: { priceString: '$4.99' } });
    purchases.purchaseProMonthly.mockResolvedValue({ entitlements: { active: {} } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await act(async () => {
      root.render(<UpgradeSheet />);
    });
    await flush();

    await tap(purchaseButton());
    expect(document.body.textContent).toContain(UPGRADE_PRICING_UNAVAILABLE);

    await tap(purchaseButton());
    expect(purchaseButton().textContent).toBe('Upgrade — $4.99');
    expect(document.body.textContent).not.toContain(UPGRADE_PRICING_UNAVAILABLE);
    expect(purchases.purchaseProMonthly).not.toHaveBeenCalled();

    await tap(purchaseButton());
    expect(purchases.purchaseProMonthly).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
  it.each(['pro', 'activating', 'entitlement', 'free'] as const)(
    'renders Settings and Upgrade from the %s state',
    async (state) => {
      if (state === 'pro') {
        vi.mocked(fetchMe).mockImplementation(async () => {
          noteServerTier('pro');
          return { subscription_tier: 'pro' } as Awaited<ReturnType<typeof fetchMe>>;
        });
      }
      if (state === 'activating') startActivation();
      if (state === 'entitlement') noteLocalEntitlement(true);
      await act(async () =>
        root.render(
          <>
            <SettingsSubscription subscriptionTier={state === 'pro' ? 'pro' : 'free'} />
            <UpgradeSheet />
          </>,
        ),
      );
      await flush();
      const text = document.body.textContent ?? '';
      expect(text).toContain(
        state === 'pro' ? 'Pro plan' : state === 'activating' ? 'Activating Pro...' : 'Free plan',
      );
      expect(text.includes('Manage subscription')).toBe(state === 'pro');
      expect(text.includes("Pro isn't active on this account yet.")).toBe(state === 'entitlement');
      expect(text).toContain('Restore purchases');
      if (state === 'activating') expect(text.match(/Activating Pro\.\.\./g)).toHaveLength(2);
      if (state === 'free' || state === 'entitlement')
        expect(text.match(/Free plan/g)).toHaveLength(2);
      if (state === 'pro') expect(text).toContain('Pro is active on this account.');
    },
  );

  it('shows activation in both rendered paths after a purchase in this session', async () => {
    purchases.purchaseProMonthly.mockImplementation(async () => {
      noteLocalEntitlement(true);
      startActivation();
      return { entitlements: { active: { pro: {} } } };
    });
    await act(async () =>
      root.render(
        <>
          <SettingsSubscription subscriptionTier="free" />
          <UpgradeSheet />
        </>,
      ),
    );
    await flush();
    const buy = Array.from(document.body.querySelectorAll('[role="button"]')).find(
      (button) => button.textContent === 'Upgrade — $4.99',
    );
    expect(buy).toBeInstanceOf(HTMLElement);
    await tap(buy as HTMLElement);
    expect(document.body.textContent?.match(/Activating Pro\.\.\./g)).toHaveLength(2);
    expect(document.body.textContent).not.toContain('Manage subscription');
    expect(document.body.textContent).not.toContain('Pro is active on this account.');
  });

  it('retries /me during activation, then renders Free on expiry and stops retrying', async () => {
    vi.useFakeTimers();
    startActivation();
    await act(async () =>
      root.render(
        <>
          <SettingsSubscription subscriptionTier="free" />
          <UpgradeSheet />
        </>,
      ),
    );
    await flush();
    vi.mocked(fetchMe).mockClear();
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(fetchMe).toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(ACTIVATION_WINDOW_MS));
    expect(document.body.textContent).not.toContain('Activating Pro...');
    expect(document.body.textContent).toContain('Free plan');
    const calls = vi.mocked(fetchMe).mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchMe).toHaveBeenCalledTimes(calls);
  });

  it('renders Pro and stops activation retries when /me confirms it', async () => {
    vi.useFakeTimers();
    startActivation();
    await act(async () =>
      root.render(
        <>
          <SettingsSubscription subscriptionTier="free" />
          <UpgradeSheet />
        </>,
      ),
    );
    await flush();
    vi.mocked(fetchMe).mockImplementation(async () => {
      noteServerTier('pro');
      return { subscription_tier: 'pro' } as Awaited<ReturnType<typeof fetchMe>>;
    });
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(document.body.textContent).toContain('Pro plan');
    expect(document.body.textContent).not.toContain('Activating Pro...');
    const calls = vi.mocked(fetchMe).mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchMe).toHaveBeenCalledTimes(calls);
  });
});
