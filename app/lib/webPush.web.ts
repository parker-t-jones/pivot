import { apiClient } from './apiClient';
import {
  rememberDesktopAlertState,
  webPushSubscriptionBody,
  type DesktopAlertState,
} from './desktopAlerts';
import { getOrCreateDeviceId } from './deviceId';

const ENDPOINT_KEY = 'pivot.web-push-endpoint';

function supportsWebPush(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  );
}

/** URL-safe base64 from a VAPID public key, as `PushManager.subscribe` requires. */
function urlBase64ToBytes(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = globalThis.atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function registerServiceWorker(): void {
  if (!supportsWebPush()) return;
  void navigator.serviceWorker.register('/sw.js');
}

export function readDesktopAlertPermission(): DesktopAlertState {
  if (!supportsWebPush()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return 'default';
}

/**
 * Call this from a click. Safari rejects `Notification.requestPermission` without a user gesture.
 */
export async function enableDesktopAlerts(): Promise<DesktopAlertState> {
  if (!supportsWebPush()) {
    rememberDesktopAlertState('unsupported');
    return 'unsupported';
  }
  const publicKey = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) {
    rememberDesktopAlertState('unconfigured');
    return 'unconfigured';
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    const state = permission === 'denied' ? 'denied' : 'default';
    rememberDesktopAlertState(state);
    return state;
  }

  const registration = await navigator.serviceWorker.register('/sw.js');
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToBytes(publicKey) as BufferSource,
  });
  const json = subscription.toJSON();
  const endpoint = subscription.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!p256dh || !auth) {
    rememberDesktopAlertState('unsupported');
    return 'unsupported';
  }

  const deviceId = await getOrCreateDeviceId();
  await apiClient.post(
    '/me/web-push-subscription',
    webPushSubscriptionBody({ deviceId, endpoint, p256dh, auth }),
  );
  try {
    sessionStorage.setItem(ENDPOINT_KEY, endpoint);
  } catch {
    // Private mode. Sign-out still reads the live subscription.
  }
  rememberDesktopAlertState('granted');
  return 'granted';
}

/** Unsubscribe this browser and delete only its row. Does not call DELETE /me/push-token. */
export async function revokeDesktopAlerts(): Promise<void> {
  if (!supportsWebPush()) return;
  let endpoint: string | null = null;
  try {
    endpoint = sessionStorage.getItem(ENDPOINT_KEY);
  } catch {
    endpoint = null;
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      endpoint = subscription.endpoint;
      await subscription.unsubscribe();
    }
  } catch {
    // The row delete below is the part that stops delivery.
  }
  if (!endpoint) return;
  try {
    await apiClient.delete('/me/web-push-subscription', { endpoint });
  } catch {
    // Sign-out continues. The next grant replaces the row by endpoint.
  }
  try {
    sessionStorage.removeItem(ENDPOINT_KEY);
  } catch {
    // Ignore.
  }
}
