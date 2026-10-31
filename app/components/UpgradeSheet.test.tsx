// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UpgradeSheet } from './UpgradeSheet';
import {
  PRIVACY_POLICY_URL,
  TERMS_OF_USE_URL,
  UPGRADE_RENEWAL_DISCLOSURE,
} from '../lib/upgradeCopy';

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
  getProMonthlyPackage: vi.fn(async () => ({ product: { priceString: '$4.99' } })),
  isPurchasesConfigured: () => true,
  purchaseProMonthly: vi.fn(),
  restorePurchases: vi.fn(),
}));

describe('UpgradeSheet purchase disclosures', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
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
  });
});
