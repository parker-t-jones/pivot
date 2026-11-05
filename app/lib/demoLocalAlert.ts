import * as Notifications from 'expo-notifications';

import { isFlagEventPayload } from './flagEventPayload';

export interface LocalDemoAlert {
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export function localDemoAlertFromDetails(details: unknown): LocalDemoAlert | null {
  if (typeof details !== 'object' || details === null) return null;
  const candidate = details as Record<string, unknown>;
  if (typeof candidate.title !== 'string' || typeof candidate.body !== 'string') return null;
  if (!isFlagEventPayload(candidate.data)) return null;
  return { title: candidate.title, body: candidate.body, data: candidate.data };
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
