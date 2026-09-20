/**
 * Pure navigation-gate decisions for Sprint 10 Phase 4 (PLAN.md Section 10 onboarding order).
 * Unit-tested without React Navigation — layouts call these, then `router.replace` / LoadingState.
 */

export type LeaguesLoadStatus = 'checking' | 'ready' | 'error';

/** OS push status from PushPermissionContext, plus its `'checking'` load state. */
export type PushGateStatus = 'checking' | 'undetermined' | 'denied' | 'granted';

/** Screens where the zero-leagues gate must not force a redirect (onboarding / connect in progress). */
export const ZERO_LEAGUES_ALLOWLIST = new Set([
  'connect-team',
  'onboarding-streaming',
  'notifications-permission',
  'onboarding-all-set',
]);

export function isHomeRouteLeaf(routeLeaf: string | undefined): boolean {
  return (
    routeLeaf === undefined ||
    routeLeaf === '(app)' ||
    routeLeaf === '(tabs)' ||
    routeLeaf === 'index'
  );
}

export function isOnZeroLeaguesAllowlist(routeLeaf: string | undefined): boolean {
  return routeLeaf !== undefined && ZERO_LEAGUES_ALLOWLIST.has(routeLeaf);
}

export type AppGateDecision =
  | { action: 'wait' }
  | { action: 'leagues_error' }
  | { action: 'redirect_connect' }
  | { action: 'redirect_notifications' }
  | { action: 'leave_notifications'; destination: 'home' | 'all-set' }
  | { action: 'render' };

/**
 * Single ordered decision for `(app)/_layout` — leagues before push; never redirect on leagues error.
 *
 * Order:
 * 1. Wait while leagues or push status is still checking
 * 2. Leagues error → error surface (no redirect)
 * 3. Zero leagues + not deferred + not allowlisted → connect-team
 * 4. On notifications-permission with push answered → leave (all-set if onboarding, else Home)
 * 5. Has leagues + undetermined + on Home → notifications catch-all
 * 6. Otherwise render the stack
 */
export function resolveAppGate(input: {
  leaguesStatus: LeaguesLoadStatus;
  leagueCount: number;
  connectDeferred: boolean;
  routeLeaf: string | undefined;
  pushStatus: PushGateStatus;
  /** `?onboarding=1` on the notifications-permission screen (onboarding chain). */
  notificationsOnboarding: boolean;
}): AppGateDecision {
  if (input.leaguesStatus === 'checking' || input.pushStatus === 'checking') {
    return { action: 'wait' };
  }

  if (input.leaguesStatus === 'error') {
    return { action: 'leagues_error' };
  }

  // leaguesStatus === 'ready'
  if (
    input.leagueCount === 0 &&
    !input.connectDeferred &&
    !isOnZeroLeaguesAllowlist(input.routeLeaf)
  ) {
    return { action: 'redirect_connect' };
  }

  const onPermissionScreen = input.routeLeaf === 'notifications-permission';

  if (onPermissionScreen && input.pushStatus !== 'undetermined') {
    return {
      action: 'leave_notifications',
      destination: input.notificationsOnboarding ? 'all-set' : 'home',
    };
  }

  if (
    input.leagueCount >= 1 &&
    input.pushStatus === 'undetermined' &&
    !onPermissionScreen &&
    isHomeRouteLeaf(input.routeLeaf)
  ) {
    return { action: 'redirect_notifications' };
  }

  return { action: 'render' };
}
