import { describe, expect, it } from 'vitest';

import { unavailableAirPlayRouteController } from './airPlayRoute';

describe('unavailableAirPlayRouteController', () => {
  it('reports no target and no active route', () => {
    expect(unavailableAirPlayRouteController.isTargetAvailable()).toBe(false);
    expect(unavailableAirPlayRouteController.activeRouteName()).toBeNull();
  });

  it('resolves the picker to false instead of throwing', async () => {
    // Off-device callers must degrade, not crash: `resolveSwitch` awaits this on every switch.
    await expect(unavailableAirPlayRouteController.presentRoutePicker()).resolves.toBe(false);
  });

  it('returns a working no-op unsubscribe', () => {
    const unsubscribe = unavailableAirPlayRouteController.subscribe(() => {
      // Never called; the point is that unsubscribing is safe.
    });

    expect(() => unsubscribe()).not.toThrow();
  });
});
