import { afterEach, describe, expect, it, vi } from 'vitest';

import { warnIfWebPushDisabled, webPushStatus } from './vapidConfig.js';

const NAMES = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const;

describe('VAPID config', () => {
  const saved = new Map<string, string | undefined>();

  afterEach(() => {
    for (const name of NAMES) {
      const previous = saved.get(name);
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
    saved.clear();
  });

  function rememberEnv(): void {
    for (const name of NAMES) saved.set(name, process.env[name]);
  }

  it('warns once per missing variable and reports disabled', () => {
    rememberEnv();
    delete process.env['VAPID_PUBLIC_KEY'];
    delete process.env['VAPID_SUBJECT'];
    process.env['VAPID_PRIVATE_KEY'] = '';
    const warn = vi.fn();

    warnIfWebPushDisabled(process.env, warn);

    expect(warn.mock.calls.map((call) => call[0])).toEqual([
      'Web Push disabled: missing VAPID_PUBLIC_KEY',
      'Web Push disabled: missing VAPID_PRIVATE_KEY',
      'Web Push disabled: missing VAPID_SUBJECT',
    ]);
    expect(webPushStatus(process.env)).toBe('disabled');
  });

  it('stays quiet and reports enabled when all three are set', () => {
    rememberEnv();
    process.env['VAPID_PUBLIC_KEY'] = 'public';
    process.env['VAPID_PRIVATE_KEY'] = 'private';
    process.env['VAPID_SUBJECT'] = 'mailto:support@pivot-sports.app';
    const warn = vi.fn();

    warnIfWebPushDisabled(process.env, warn);

    expect(warn).not.toHaveBeenCalled();
    expect(webPushStatus(process.env)).toBe('enabled');
  });
});
