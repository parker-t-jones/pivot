import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getPermissionsAsync, scheduleNotificationAsync } = vi.hoisted(() => ({
  getPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
}));

vi.mock('expo-notifications', () => ({
  getPermissionsAsync,
  scheduleNotificationAsync,
  SchedulableTriggerInputTypes: {
    TIME_INTERVAL: 'timeInterval',
  },
}));

import { NotificationsDisabledError, scheduleTestFlagNotificationAsync } from './devNotifications';

describe('scheduleTestFlagNotificationAsync', () => {
  beforeEach(() => {
    getPermissionsAsync.mockReset();
    scheduleNotificationAsync.mockReset();
    scheduleNotificationAsync.mockResolvedValue('notification-id');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not schedule when OS permission is denied', async () => {
    getPermissionsAsync.mockResolvedValue({ status: 'denied' });

    await expect(scheduleTestFlagNotificationAsync()).rejects.toBeInstanceOf(
      NotificationsDisabledError,
    );
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('does not schedule when OS permission is still undetermined', async () => {
    getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });

    await expect(scheduleTestFlagNotificationAsync()).rejects.toBeInstanceOf(
      NotificationsDisabledError,
    );
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('schedules a 2s local notification when permission is granted', async () => {
    getPermissionsAsync.mockResolvedValue({ status: 'granted' });

    await scheduleTestFlagNotificationAsync();

    expect(scheduleNotificationAsync).toHaveBeenCalledOnce();
    const [request] = scheduleNotificationAsync.mock.calls[0] as [
      { trigger: { seconds: number }; content: { title: string } },
    ];
    expect(request.trigger.seconds).toBe(2);
    expect(request.content.title).toBe('Jonathan Taylor active');
  });
});
