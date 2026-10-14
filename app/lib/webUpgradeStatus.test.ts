import { describe, expect, it } from 'vitest';

import { webUpgradeStatus } from './webUpgradeStatus';

describe('web upgrade status', () => {
  it('names Pro or points to the iOS app', () => {
    expect(webUpgradeStatus(true)).toBe("You're on Pro");
    expect(webUpgradeStatus(false)).toBe('Pivot Pro is available in the iOS app');
  });
});
