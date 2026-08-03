import { afterEach, describe, expect, it } from 'vitest';

import {
  clearConnectDeferredForSession,
  deferConnectForSession,
  isConnectDeferredForSession,
  resetConnectDeferredForSessionForTests,
} from './connectDeferredSession';
import { resolveAppGate } from './navigationGates';

describe('connectDeferredSession', () => {
  afterEach(() => {
    resetConnectDeferredForSessionForTests();
  });

  it('is readable synchronously in the same turn as defer (Close → navigate race)', () => {
    expect(isConnectDeferredForSession()).toBe(false);
    deferConnectForSession();
    // No await, no React paint — gate must already see true when replace re-renders Home.
    expect(isConnectDeferredForSession()).toBe(true);
  });

  it('survives a provider remount simulation (module scope outlives React tree)', () => {
    deferConnectForSession();

    // Simulate LeaguesGateProvider unmount + remount: React state would reset to false;
    // the session module must not.
    let providerMirrorDeferred = false; // fresh provider useState(false)
    expect(providerMirrorDeferred).toBe(false);
    expect(isConnectDeferredForSession()).toBe(true);

    // Gate reads the session module (as AppNavigator does after the fix).
    expect(
      resolveAppGate({
        leaguesStatus: 'ready',
        leagueCount: 0,
        connectDeferred: isConnectDeferredForSession(),
        routeLeaf: 'index',
        pushStatus: 'denied',
        notificationsOnboarding: false,
      }),
    ).toEqual({ action: 'render' });
  });

  it('Close path: defer then land on Home does not redirect_connect', () => {
    deferConnectForSession();
    expect(
      resolveAppGate({
        leaguesStatus: 'ready',
        leagueCount: 0,
        connectDeferred: isConnectDeferredForSession(),
        routeLeaf: 'index',
        pushStatus: 'denied',
        notificationsOnboarding: false,
      }),
    ).toEqual({ action: 'render' });
  });

  it('clear resets for league-connected / tests', () => {
    deferConnectForSession();
    clearConnectDeferredForSession();
    expect(isConnectDeferredForSession()).toBe(false);
  });
});
