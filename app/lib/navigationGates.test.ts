import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetConnectDeferredForSessionForTests } from './connectDeferredSession';
import { navigateAfterConnect, resetToHomeRoot } from './navigateAfterConnect';
import {
  isHomeRouteLeaf,
  isOnZeroLeaguesAllowlist,
  NOTIF_PROMPT_DISMISS_KEY,
  NOTIF_PROMPT_SNOOZE_MS,
  readNotifPromptSnoozed,
  resetNotifPromptSessionForTests,
  resolveAppGate,
  webPushConfigured,
  writeNotifPromptDismissed,
} from './navigationGates';

afterEach(() => {
  resetConnectDeferredForSessionForTests();
  resetNotifPromptSessionForTests();
});

describe('isHomeRouteLeaf', () => {
  it('treats app group / index as Home', () => {
    expect(isHomeRouteLeaf(undefined)).toBe(true);
    expect(isHomeRouteLeaf('(app)')).toBe(true);
    expect(isHomeRouteLeaf('(tabs)')).toBe(true);
    expect(isHomeRouteLeaf('index')).toBe(true);
  });

  it('does not treat settings, lineup, or onboarding as Home', () => {
    expect(isHomeRouteLeaf('settings')).toBe(false);
    expect(isHomeRouteLeaf('lineup')).toBe(false);
    expect(isHomeRouteLeaf('connect-team')).toBe(false);
    expect(isHomeRouteLeaf('onboarding-streaming')).toBe(false);
  });
});

describe('resolveAppGate — zero leagues', () => {
  const base = {
    leaguesStatus: 'ready' as const,
    leagueCount: 0,
    connectDeferred: false,
    routeLeaf: 'index' as string | undefined,
    pushStatus: 'denied' as const,
    notificationsOnboarding: false,
    webPushConfigured: true,
    notifPromptSnoozed: false,
  };

  it('zero leagues → redirect_connect', () => {
    expect(resolveAppGate(base)).toEqual({ action: 'redirect_connect' });
  });

  it('has leagues → does not redirect to connect', () => {
    expect(resolveAppGate({ ...base, leagueCount: 1 })).toEqual({ action: 'render' });
  });

  it('Close / connectDeferred → Home State 5 path (render, no bounce)', () => {
    expect(resolveAppGate({ ...base, connectDeferred: true })).toEqual({ action: 'render' });
  });

  it('cold start after deferring: connectDeferred false again → prompts connect', () => {
    // Simulates a new provider mount (in-memory reset) with zero leagues.
    expect(resolveAppGate({ ...base, connectDeferred: false })).toEqual({
      action: 'redirect_connect',
    });
  });

  it('allowlist prevents mid-chain bounce on connect-team', () => {
    expect(resolveAppGate({ ...base, routeLeaf: 'connect-team' })).toEqual({ action: 'render' });
  });

  it('/leagues error → leagues_error, never redirect either direction', () => {
    expect(
      resolveAppGate({
        ...base,
        leaguesStatus: 'error',
        leagueCount: 0,
        pushStatus: 'undetermined',
      }),
    ).toEqual({ action: 'leagues_error' });

    expect(
      resolveAppGate({
        ...base,
        leaguesStatus: 'error',
        leagueCount: 99,
        routeLeaf: 'index',
        pushStatus: 'undetermined',
      }),
    ).toEqual({ action: 'leagues_error' });
  });

  it('checking leagues → wait (no decide-then-redecide)', () => {
    expect(resolveAppGate({ ...base, leaguesStatus: 'checking' })).toEqual({ action: 'wait' });
  });
});

describe('resolveAppGate — push permission', () => {
  const withLeagues = {
    leaguesStatus: 'ready' as const,
    leagueCount: 2,
    connectDeferred: false,
    routeLeaf: 'index' as string | undefined,
    pushStatus: 'undetermined' as const,
    notificationsOnboarding: false,
    webPushConfigured: true,
    notifPromptSnoozed: false,
  };

  it('push gate does not fire when league count is 0', () => {
    expect(
      resolveAppGate({
        ...withLeagues,
        leagueCount: 0,
        connectDeferred: true, // on Home with zero leagues after Close
        pushStatus: 'undetermined',
      }),
    ).toEqual({ action: 'render' });
  });

  it('push catch-all fires on Home when count >= 1 and undetermined', () => {
    expect(resolveAppGate(withLeagues)).toEqual({ action: 'redirect_notifications' });
  });

  it('push gate does not fire mid onboarding chain (not Home)', () => {
    expect(resolveAppGate({ ...withLeagues, routeLeaf: 'onboarding-streaming' })).toEqual({
      action: 'render',
    });
    expect(resolveAppGate({ ...withLeagues, routeLeaf: 'onboarding-all-set' })).toEqual({
      action: 'render',
    });
    expect(resolveAppGate({ ...withLeagues, routeLeaf: 'settings' })).toEqual({
      action: 'render',
    });
  });

  it('full new-user chain allowlist: connect → streaming → notifications → all-set stay render', () => {
    for (const leaf of [
      'connect-team',
      'onboarding-streaming',
      'notifications-permission',
      'onboarding-all-set',
    ]) {
      expect(
        resolveAppGate({
          leaguesStatus: 'ready',
          leagueCount: leaf === 'connect-team' ? 0 : 1,
          connectDeferred: false,
          routeLeaf: leaf,
          pushStatus: 'undetermined',
          notificationsOnboarding: leaf === 'notifications-permission',
          webPushConfigured: true,
          notifPromptSnoozed: false,
        }),
      ).toEqual({ action: 'render' });
    }
  });

  it('leave notifications → all-set when onboarding param set', () => {
    expect(
      resolveAppGate({
        ...withLeagues,
        routeLeaf: 'notifications-permission',
        pushStatus: 'granted',
        notificationsOnboarding: true,
      }),
    ).toEqual({ action: 'leave_notifications', destination: 'all-set' });
  });

  it('leave notifications → home when not onboarding (catch-all path)', () => {
    expect(
      resolveAppGate({
        ...withLeagues,
        routeLeaf: 'notifications-permission',
        pushStatus: 'denied',
        notificationsOnboarding: false,
      }),
    ).toEqual({ action: 'leave_notifications', destination: 'home' });
  });

  it('unconfigured web push → no redirect', () => {
    expect(resolveAppGate({ ...withLeagues, webPushConfigured: false })).toEqual({
      action: 'render',
    });
  });

  it('snoozed prompt → no redirect', () => {
    expect(resolveAppGate({ ...withLeagues, notifPromptSnoozed: true })).toEqual({
      action: 'render',
    });
  });

  it('configured and not snoozed → redirect_notifications', () => {
    expect(
      resolveAppGate({
        ...withLeagues,
        webPushConfigured: true,
        notifPromptSnoozed: false,
      }),
    ).toEqual({ action: 'redirect_notifications' });
  });

  it('native inputs (configured, not snoozed) redirect on Home the same as before', () => {
    expect(
      resolveAppGate({
        ...withLeagues,
        webPushConfigured: true,
        notifPromptSnoozed: false,
        routeLeaf: 'index',
        pushStatus: 'undetermined',
      }),
    ).toEqual({ action: 'redirect_notifications' });
  });
});

describe('web push prompt inputs', () => {
  it('native is configured even without a VAPID key, and never snoozed', () => {
    expect(webPushConfigured('ios', undefined)).toBe(true);
    expect(webPushConfigured('ios', '')).toBe(true);
    expect(
      readNotifPromptSnoozed({
        platform: 'ios',
        readItem: () => {
          throw new Error('native has no localStorage');
        },
      }),
    ).toBe(false);
  });

  it('web is unconfigured only when the VAPID public key is missing', () => {
    expect(webPushConfigured('web', undefined)).toBe(false);
    expect(webPushConfigured('web', '')).toBe(false);
    expect(webPushConfigured('web', 'BPublicKey')).toBe(true);
  });

  it('a dismiss within 7 days snoozes; exactly 7 days later does not', () => {
    const now = 1_700_000_000_000;
    const store = new Map<string, string>();
    writeNotifPromptDismissed({
      platform: 'web',
      now,
      writeItem: (key, value) => {
        store.set(key, value);
      },
    });
    expect(store.get(NOTIF_PROMPT_DISMISS_KEY)).toBe(String(now));
    const readItem = (key: string) => store.get(key) ?? null;
    expect(
      readNotifPromptSnoozed({
        platform: 'web',
        now: now + NOTIF_PROMPT_SNOOZE_MS - 1,
        readItem,
      }),
    ).toBe(true);
    expect(
      readNotifPromptSnoozed({
        platform: 'web',
        now: now + NOTIF_PROMPT_SNOOZE_MS,
        readItem,
      }),
    ).toBe(false);
  });

  it('a storage throw snoozes for the rest of the session', () => {
    expect(
      readNotifPromptSnoozed({
        platform: 'web',
        readItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe(true);
    expect(
      readNotifPromptSnoozed({
        platform: 'web',
        readItem: () => null,
      }),
    ).toBe(true);

    resetNotifPromptSessionForTests();
    writeNotifPromptDismissed({
      platform: 'web',
      writeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(
      readNotifPromptSnoozed({
        platform: 'web',
        readItem: () => null,
      }),
    ).toBe(true);
  });
});

describe('isOnZeroLeaguesAllowlist', () => {
  it('includes onboarding chain screens', () => {
    expect(isOnZeroLeaguesAllowlist('connect-team')).toBe(true);
    expect(isOnZeroLeaguesAllowlist('onboarding-streaming')).toBe(true);
    expect(isOnZeroLeaguesAllowlist('notifications-permission')).toBe(true);
    expect(isOnZeroLeaguesAllowlist('onboarding-all-set')).toBe(true);
    expect(isOnZeroLeaguesAllowlist('index')).toBe(false);
  });
});

describe('navigateAfterConnect', () => {
  it('onboarding → streaming (does not dismissTo Home)', () => {
    const router = {
      replace: vi.fn(),
      dismissTo: vi.fn(),
    };
    navigateAfterConnect(router, { onboarding: true });
    expect(router.replace).toHaveBeenCalledWith('/(app)/onboarding-streaming');
    expect(router.dismissTo).not.toHaveBeenCalled();
  });

  it('Settings / non-onboarding → dismissTo Home root (Settings not left underneath)', () => {
    const router = {
      replace: vi.fn(),
      dismissTo: vi.fn(),
    };
    navigateAfterConnect(router, { onboarding: false });
    expect(router.dismissTo).toHaveBeenCalledWith('/(app)');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('resetToHomeRoot uses dismissTo', () => {
    const router = {
      replace: vi.fn(),
      dismissTo: vi.fn(),
    };
    resetToHomeRoot(router);
    expect(router.dismissTo).toHaveBeenCalledWith('/(app)');
  });
});
