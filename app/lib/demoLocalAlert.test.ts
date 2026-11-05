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

import { presentDemoAlertWithoutToken } from './demoLocalAlert';

const DETAILS = {
  title: 'Sam Hart active',
  body: 'Chiefs have the ball — Q2, 7:14. Watch on CBS.',
  data: {
    event_id: 'event-1',
    user_id: 'user-1',
    game_id: 'de000000-0000-4000-8000-000000000001',
    event_type: 'flag_added',
    game_summary: { home_team: 'KC' },
  },
};

describe('presentDemoAlertWithoutToken', () => {
  beforeEach(() => {
    getPermissionsAsync.mockReset();
    scheduleNotificationAsync.mockReset();
    scheduleNotificationAsync.mockResolvedValue('notification-id');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not schedule when OS permission is off', async () => {
    getPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await expect(presentDemoAlertWithoutToken(DETAILS)).resolves.toBe('permission_off');
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('schedules the fixture alert when permission is already granted', async () => {
    getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    await expect(presentDemoAlertWithoutToken(DETAILS)).resolves.toBe('scheduled');
    expect(scheduleNotificationAsync).toHaveBeenCalledOnce();
    const [request] = scheduleNotificationAsync.mock.calls[0] as [
      { content: { title: string; body: string } },
    ];
    expect(request.content.title).toBe('Sam Hart active');
    expect(request.content.body).toContain('Chiefs');
    expect(request.content.body).not.toMatch(/Jonathan|Taylor|Colts/);
  });
});
