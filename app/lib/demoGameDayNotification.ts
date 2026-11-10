import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { DEMO_ALERTS } from './demoGameDay';
import { NotificationsDisabledError } from './devNotifications';

/** Smallest trigger the OS accepts as "later". Immediate triggers risk being coalesced (below). */
const MIN_TRIGGER_SECONDS = 1;

/**
 * Schedules the demo's three local notifications up front, each at its alert time (issue #69).
 * They exist for the BACKGROUND case: iOS suspends the app's timers once it is backgrounded, so the
 * OS has to deliver them. In the foreground `NotificationBannerHost`'s handler suppresses the OS
 * banner, and the demo screen shows its own in-app banner instead, so a person sees each alert once.
 * Same `scheduleNotificationAsync` path as `scheduleTestFlagNotificationAsync`: no server call, no
 * push token. Triggers are at least 1s (not 0s) for the reason `devNotifications.ts` found: an
 * immediate trigger risks the OS coalescing delivery into the call stack that scheduled it.
 *
 * Resolves with the scheduled identifiers (for `cancelDemoGameDayNotificationsAsync`), or an empty
 * list on web, where `expo-notifications` local scheduling does not work. Throws
 * `NotificationsDisabledError` without OS permission (never prompts); a failure partway cancels
 * what was already scheduled and rethrows, so the caller never holds a partial set.
 */
export async function scheduleDemoGameDayNotificationsAsync(
  startedAtMs: number,
  nowMs: number = Date.now(),
): Promise<string[]> {
  if (Platform.OS === 'web') return [];

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    throw new NotificationsDisabledError();
  }

  const ids: string[] = [];
  try {
    for (const alert of DEMO_ALERTS) {
      const seconds = Math.max(
        MIN_TRIGGER_SECONDS,
        Math.round((startedAtMs + alert.atMs - nowMs) / 1000),
      );
      ids.push(
        await Notifications.scheduleNotificationAsync({
          content: {
            title: alert.title,
            body: alert.body,
            // `demo` is not a flag event, so neither the foreground banner host nor the tap handler
            // treats it as one: a tap never deep-links, records an action, or touches real data.
            data: { demo: true, kind: alert.kind },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds,
          },
        }),
      );
    }
  } catch (error) {
    await cancelDemoGameDayNotificationsAsync(ids);
    throw error;
  }
  return ids;
}

/** Cancels any of the demo's notifications that have not fired yet (Exit, or leaving the screen). */
export async function cancelDemoGameDayNotificationsAsync(ids: readonly string[]): Promise<void> {
  await Promise.all(
    ids.map((id) =>
      Notifications.cancelScheduledNotificationAsync(id).catch(() => {
        // Already delivered or already gone; nothing to undo.
      }),
    ),
  );
}
