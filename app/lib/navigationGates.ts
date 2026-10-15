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
 * 5. Has leagues + undetermined + on Home → notifications catch-all,
 *    only when web push is configured and the prompt is not snoozed
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
  /**
   * False on web when `EXPO_PUBLIC_VAPID_PUBLIC_KEY` is missing — the same check
   * `enableDesktopAlerts` uses before it returns `unconfigured`. Always true on native.
   * Omitted means configured, so callers that predate this input keep the old redirect.
   */
  webPushConfigured?: boolean;
  /**
   * Web only. True for 7 days after "Not now", or for the session if storage throws.
   * Omitted means not snoozed.
   */
  notifPromptSnoozed?: boolean;
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

  const webPushReady = input.webPushConfigured ?? true;
  const promptSnoozed = input.notifPromptSnoozed ?? false;

  if (
    webPushReady &&
    !promptSnoozed &&
    input.leagueCount >= 1 &&
    input.pushStatus === 'undetermined' &&
    !onPermissionScreen &&
    isHomeRouteLeaf(input.routeLeaf)
  ) {
    return { action: 'redirect_notifications' };
  }

  return { action: 'render' };
}

/** localStorage key written by "Not now" on the web alerts screen. */
export const NOTIF_PROMPT_DISMISS_KEY = 'pivot.notifPrompt.dismissedAt';

/** How long "Not now" keeps the Home redirect from firing again. */
export const NOTIF_PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/** Set when storage throws, so a blocked localStorage cannot redirect in a loop. */
let sessionSnoozed = false;

export function resetNotifPromptSessionForTests(): void {
  sessionSnoozed = false;
}

/**
 * Native is always configured. Web matches `webPush.web.ts`: a missing or empty
 * VAPID public key is unconfigured.
 */
export function webPushConfigured(platform: string, vapidPublicKey: string | undefined): boolean {
  if (platform !== 'web') return true;
  return Boolean(vapidPublicKey);
}

/**
 * Web only. True when `pivot.notifPrompt.dismissedAt` is within the last 7 days.
 * A storage throw snoozes for the rest of this session. Native is always false.
 */
export function readNotifPromptSnoozed(input: {
  platform: string;
  now?: number;
  readItem: (key: string) => string | null;
}): boolean {
  if (input.platform !== 'web') return false;
  if (sessionSnoozed) return true;
  try {
    const raw = input.readItem(NOTIF_PROMPT_DISMISS_KEY);
    if (raw == null || raw.length === 0) return false;
    const dismissedAt = Number(raw);
    if (!Number.isFinite(dismissedAt)) return false;
    const now = input.now ?? Date.now();
    return now - dismissedAt < NOTIF_PROMPT_SNOOZE_MS;
  } catch {
    sessionSnoozed = true;
    return true;
  }
}

/** Web only. Writes the dismiss timestamp. A throw snoozes for the rest of this session. */
export function writeNotifPromptDismissed(input: {
  platform: string;
  now?: number;
  writeItem: (key: string, value: string) => void;
}): void {
  if (input.platform !== 'web') return;
  try {
    input.writeItem(NOTIF_PROMPT_DISMISS_KEY, String(input.now ?? Date.now()));
  } catch {
    sessionSnoozed = true;
  }
}
