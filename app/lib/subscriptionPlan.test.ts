import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearActivation,
  startActivation,
  isActivatingPro,
  ACTIVATION_WINDOW_MS,
  currentSettingsPlanLabel,
  noteLocalEntitlement,
  noteServerTier,
  settingsPlanLabel,
} from './subscriptionPlan';

describe('settings plan label', () => {
  afterEach(() => {
    clearActivation();
    vi.useRealTimers();
    noteServerTier('free');
    noteLocalEntitlement(false);
  });

  it('shows Pro when the server tier is pro', () => {
    expect(settingsPlanLabel('pro')).toBe('Pro plan');
  });

  it('shows Free when only the local entitlement is active', () => {
    expect(settingsPlanLabel('free')).toBe('Free plan');
    noteServerTier('free');
    noteLocalEntitlement(true);
    expect(currentSettingsPlanLabel()).toBe('Free plan');
  });

  it('shows Free when neither source is pro', () => {
    expect(settingsPlanLabel('free')).toBe('Free plan');
    expect(currentSettingsPlanLabel()).toBe('Free plan');
  });
});

it('clears activation when the server confirms Pro or three minutes elapse', () => {
  vi.useFakeTimers();
  startActivation();
  expect(isActivatingPro()).toBe(true);
  noteServerTier('pro');
  expect(isActivatingPro()).toBe(false);
  noteServerTier('free');
  expect(isActivatingPro()).toBe(false);
  startActivation();
  vi.advanceTimersByTime(ACTIVATION_WINDOW_MS);
  expect(isActivatingPro()).toBe(false);
  vi.useRealTimers();
});
