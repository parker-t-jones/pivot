export type DesktopAlertState = 'granted' | 'denied' | 'default' | 'unsupported' | 'unconfigured';

/** Copy for Settings and the onboarding screen. Permission is requested only from a click. */
export function desktopAlertCopy(state: DesktopAlertState): string {
  switch (state) {
    case 'granted':
      return 'Desktop alerts are on for this browser.';
    case 'denied':
      return "Desktop alerts are blocked. Allow notifications for this site in the browser's site settings, then try again.";
    case 'unsupported':
      return 'This browser does not support desktop alerts.';
    case 'unconfigured':
      return 'Desktop alerts are not available in this build.';
    case 'default':
      return 'Enable desktop alerts to hear about a player while this tab is in the background.';
  }
}

export function webPushSubscriptionBody(input: {
  deviceId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}): { deviceId: string; endpoint: string; p256dh: string; auth: string } {
  return {
    deviceId: input.deviceId,
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
  };
}

let lastState: DesktopAlertState = 'default';

export function lastDesktopAlertState(): DesktopAlertState {
  return lastState;
}

export function rememberDesktopAlertState(state: DesktopAlertState): void {
  lastState = state;
}
