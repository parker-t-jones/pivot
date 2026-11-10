import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  cancelScheduledNotificationAsync: vi.fn(),
  platform: { OS: 'ios' as string },
}));

vi.mock('expo-notifications', () => ({
  getPermissionsAsync: mocks.getPermissionsAsync,
  scheduleNotificationAsync: mocks.scheduleNotificationAsync,
  cancelScheduledNotificationAsync: mocks.cancelScheduledNotificationAsync,
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));
vi.mock('react-native', () => ({ Platform: mocks.platform }));

import { DEMO_ALERTS } from './demoGameDay';
import {
  cancelDemoGameDayNotificationsAsync,
  scheduleDemoGameDayNotificationsAsync,
} from './demoGameDayNotification';
import { NotificationsDisabledError } from './devNotifications';

describe('scheduleDemoGameDayNotificationsAsync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.platform.OS = 'ios';
    mocks.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    let n = 0;
    mocks.scheduleNotificationAsync.mockImplementation(async () => `id-${(n += 1)}`);
    mocks.cancelScheduledNotificationAsync.mockResolvedValue(undefined);
  });

  it('schedules all three alerts at their own times, in order, with the demo copy', async () => {
    const ids = await scheduleDemoGameDayNotificationsAsync(1_000_000, 1_000_000);
    expect(ids).toEqual(['id-1', 'id-2', 'id-3']);
    const calls = mocks.scheduleNotificationAsync.mock.calls.map(([arg]) => arg);
    expect(calls).toHaveLength(3);
    calls.forEach((call, i) => {
      const alert = DEMO_ALERTS[i];
      expect(call.content.title).toBe(alert?.title);
      expect(call.content.body).toBe(alert?.body);
      expect(call.trigger).toEqual({
        type: 'timeInterval',
        seconds: Math.round((alert?.atMs ?? 0) / 1000),
      });
    });
    const seconds = calls.map((call) => call.trigger.seconds as number);
    expect(seconds).toEqual([...seconds].sort((a, b) => a - b));
    expect(new Set(seconds).size).toBe(3);
  });

  it('marks every payload as demo data, not a flag event, so a tap never deep-links', async () => {
    await scheduleDemoGameDayNotificationsAsync(0, 0);
    for (const [arg] of mocks.scheduleNotificationAsync.mock.calls) {
      expect(arg.content.data.demo).toBe(true);
      expect(arg.content.data.event_id).toBeUndefined();
      expect(arg.content.data.game_id).toBeUndefined();
    }
  });

  it('measures each trigger from now, not from the start, when scheduling is late', async () => {
    await scheduleDemoGameDayNotificationsAsync(0, 2_000);
    const seconds = mocks.scheduleNotificationAsync.mock.calls.map(([arg]) => arg.trigger.seconds);
    expect(seconds).toEqual(DEMO_ALERTS.map((alert) => Math.round((alert.atMs - 2_000) / 1000)));
  });

  it('never schedules sooner than 1s', async () => {
    await scheduleDemoGameDayNotificationsAsync(0, 60_000);
    for (const [arg] of mocks.scheduleNotificationAsync.mock.calls) {
      expect(arg.trigger.seconds).toBe(1);
    }
  });

  it('throws without OS permission and schedules nothing', async () => {
    mocks.getPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await expect(scheduleDemoGameDayNotificationsAsync(0)).rejects.toBeInstanceOf(
      NotificationsDisabledError,
    );
    expect(mocks.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('does nothing on web, where local scheduling does not work', async () => {
    mocks.platform.OS = 'web';
    await expect(scheduleDemoGameDayNotificationsAsync(0)).resolves.toEqual([]);
    expect(mocks.getPermissionsAsync).not.toHaveBeenCalled();
    expect(mocks.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('cancels what it already scheduled when a later one fails, and rethrows', async () => {
    mocks.scheduleNotificationAsync
      .mockResolvedValueOnce('a')
      .mockResolvedValueOnce('b')
      .mockRejectedValueOnce(new Error('boom'));
    await expect(scheduleDemoGameDayNotificationsAsync(0)).rejects.toThrow('boom');
    expect(mocks.cancelScheduledNotificationAsync.mock.calls.map(([id]) => id)).toEqual(['a', 'b']);
  });
});

describe('cancelDemoGameDayNotificationsAsync', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cancels each id, and swallows one that is already gone', async () => {
    mocks.cancelScheduledNotificationAsync
      .mockRejectedValueOnce(new Error('gone'))
      .mockResolvedValueOnce(undefined);
    await expect(cancelDemoGameDayNotificationsAsync(['a', 'b'])).resolves.toBeUndefined();
    expect(mocks.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(2);
  });

  it('does nothing for an empty list', async () => {
    await cancelDemoGameDayNotificationsAsync([]);
    expect(mocks.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });
});
