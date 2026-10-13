import type { DesktopAlertState } from './desktopAlerts';

/** Native builds do not register a service worker or touch the Web Push API. */
export function registerServiceWorker(): void {
  // No-op on native.
}

export function readDesktopAlertPermission(): DesktopAlertState {
  return 'unsupported';
}

export async function enableDesktopAlerts(): Promise<DesktopAlertState> {
  return 'unsupported';
}

export async function revokeDesktopAlerts(): Promise<void> {
  // No-op on native.
}
