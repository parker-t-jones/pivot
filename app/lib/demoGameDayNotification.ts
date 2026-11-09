import * as Notifications from 'expo-notifications';

import { DEMO_NOTIFICATION_BODY, DEMO_NOTIFICATION_TITLE } from './demoGameDay';
import { NotificationsDisabledError } from './devNotifications';

/**
 * Schedules the demo's one local notification when its live phase begins (§12.2: "drives Home
 * through PRE-GAME → LIVE with a flag → a local notification"). Same `scheduleNotificationAsync`
 * path as `scheduleTestFlagNotificationAsync` — no server call, no push token. A 2s trigger (not
 * 0s) for the same reason: `devNotifications.ts` found that an immediate trigger risks the OS
 * coalescing delivery into the call stack that scheduled it.
 */
export async function scheduleDemoGameDayNotificationAsync(): Promise<void> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    throw new NotificationsDisabledError();
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title: DEMO_NOTIFICATION_TITLE,
      body: DEMO_NOTIFICATION_BODY,
      data: { demo: true },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 2,
    },
  });
}
