import { afterEach, describe, expect, it } from 'vitest';

import {
  currentSettingsPlanLabel,
  noteLocalEntitlement,
  noteServerTier,
  settingsPlanLabel,
} from './subscriptionPlan';

describe('settings plan label', () => {
  afterEach(() => {
    noteServerTier('free');
    noteLocalEntitlement(false);
  });

  it('shows Pro when the server tier is pro', () => {
    expect(settingsPlanLabel('pro', false)).toBe('Pro plan');
  });

  it('shows Pro when the local entitlement is active even if the server still says free', () => {
    expect(settingsPlanLabel('free', true)).toBe('Pro plan');
    noteServerTier('free');
    noteLocalEntitlement(true);
    expect(currentSettingsPlanLabel()).toBe('Pro plan');
  });

  it('shows Free when neither source is pro', () => {
    expect(settingsPlanLabel('free', false)).toBe('Free plan');
    expect(currentSettingsPlanLabel()).toBe('Free plan');
  });
});
