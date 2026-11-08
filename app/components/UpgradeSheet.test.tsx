// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UpgradeSheet } from './UpgradeSheet';
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
  fetchMe: vi.fn(async () => ({ subscription_tier: 'free' })),
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
});
