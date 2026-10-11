import { describe, expect, it } from 'vitest';
import {
  desktopAlertCopy,
  lastDesktopAlertState,
  rememberDesktopAlertState,
  webPushSubscriptionBody,
} from './desktopAlerts';

describe('desktop alerts', () => {
  it('names the blocked and unsupported states without asking for a permission', () => {
    expect(desktopAlertCopy('denied')).toContain('site settings');
    expect(desktopAlertCopy('unsupported')).toContain('does not support');
    expect(desktopAlertCopy('unconfigured')).toContain('not available');
    expect(desktopAlertCopy('granted')).toContain('on for this browser');
  });

  it('posts the same device id the socket uses', () => {
    const deviceId = '22222222-2222-4222-8222-222222222222';
    expect(
      webPushSubscriptionBody({
        deviceId,
        endpoint: 'https://push.example.test/1',
        p256dh: 'key',
        auth: 'auth',
      }),
    ).toEqual({
      deviceId,
      endpoint: 'https://push.example.test/1',
      p256dh: 'key',
      auth: 'auth',
    });
  });

  it('remembers the result of the last click', () => {
    rememberDesktopAlertState('denied');
    expect(lastDesktopAlertState()).toBe('denied');
    rememberDesktopAlertState('default');
  });
});
