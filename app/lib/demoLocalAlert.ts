import * as Notifications from 'expo-notifications';

import { isFlagEventPayload } from './flagEventPayload';

export interface LocalDemoAlert {
  title: string;
  body: string;
  data: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function localDemoAlertFromDetails(details: unknown): LocalDemoAlert | null {
  if (!isRecord(details)) return null;
  if (typeof details.title !== 'string' || typeof details.body !== 'string') return null;
  // isRecord first so `data` narrows to `Record<string, unknown> & FlagEventPayload`: the
  // FlagEventPayload interface has no index signature, so on its own it can't be Expo's `data`.
  const { data } = details;
  if (!isRecord(data) || !isFlagEventPayload(data)) return null;
  return { title: details.title, body: details.body, data };
}

/**
 * Simulator builds grant the notification permission and still have no Expo push token.
 * The API returns the fixture alert on that 409. Present it locally so the in-app banner runs.
 */
export async function presentDemoAlertWithoutToken(
  details: unknown,
): Promise<'scheduled' | 'permission_off' | 'unusable'> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return 'permission_off';
  const alert = localDemoAlertFromDetails(details);
  if (!alert) return 'unusable';

  await Notifications.scheduleNotificationAsync({
    content: {
      title: alert.title,
      body: alert.body,
      data: alert.data,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 2,
    },
  });
  return 'scheduled';
}
