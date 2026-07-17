import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

import { apiClient } from './apiClient';

interface PushTokenResponse {
  expo_push_token: string | null;
}

/** `expo-secure-store` keys are restricted to alphanumeric characters plus `.`, `-`, and `_` — no
 *  `:` (SecureStore throws `Invalid key provided` otherwise, caught live on sign-out). */
function pushTokenCacheKey(userId: string): string {
  return `push_token.${userId}`;
}

/** EAS project id, without which `getExpoPushTokenAsync` can't attribute a token to this project —
 *  same fallback chain Expo's own docs recommend. `null` (rather than throwing) when unset, so a
 *  project that hasn't run `eas init` yet degrades to "push registration skipped," not a crash. */
function resolveEasProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

/**
 * Registers this device's current Expo push token with the server (`POST /me/push-token`),
 * unless it's unchanged from the last token this device successfully registered for this user
 * (Sprint 6 Phase 5 decision #3 — a SecureStore cache keyed by `user_id` keeps cold starts quiet).
 *
 * Callers are responsible for permission already being granted (`PushPermissionContext` requests
 * it, gated on user intent per PLAN.md Section 10 step 5) — this function does not request it, and
 * silently no-ops if permission isn't granted or the device can't produce a token (simulator, no
 * EAS project id configured). Deliberately quiet on all of those: none of them are actionable by
 * the caller mid-session, and Phase 6+ will surface actual notification failures where it matters.
 */
export async function registerForPushNotificationsAsync(userId: string): Promise<void> {
  if (!Device.isDevice) {
    return; // Simulators have no push capability — getExpoPushTokenAsync would throw.
  }

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    return;
  }

  const projectId = resolveEasProjectId();
  if (!projectId) {
    console.warn(
      '[push] no EAS projectId configured (app.json extra.eas.projectId) — skipping push token registration.',
    );
    return;
  }

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

  const cacheKey = pushTokenCacheKey(userId);
  const cachedToken = await SecureStore.getItemAsync(cacheKey);
  if (cachedToken === token) {
    return; // Unchanged since our last successful registration — skip the round trip.
  }

  console.log(`[push] registering token via POST /me/push-token for user ${userId}`);
  await apiClient.post<PushTokenResponse>('/me/push-token', { token, platform: 'ios' });
  await SecureStore.setItemAsync(cacheKey, token);
}

/**
 * Sign-out flow (Sprint 6 Phase 5 decision #4): best-effort `DELETE /me/push-token`, then always
 * clears the local cache regardless of whether the server call succeeded — a network failure here
 * must never block sign-out. A stale server-side token left behind by a failed DELETE self-heals
 * the next time this device signs in and re-registers a (likely identical) token.
 */
export async function unregisterPushNotificationsAsync(userId: string): Promise<void> {
  try {
    await apiClient.delete<PushTokenResponse>('/me/push-token');
  } catch (error) {
    console.warn('[push] DELETE /me/push-token failed during sign-out — proceeding anyway.', error);
  }
  try {
    await SecureStore.deleteItemAsync(pushTokenCacheKey(userId));
  } catch (error) {
    console.warn('[push] clearing local push token cache failed — proceeding anyway.', error);
  }
}
