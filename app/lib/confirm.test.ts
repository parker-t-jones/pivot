import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
}));

import { Alert } from 'react-native';

import { alertAsync, confirmAsync, type ConfirmOptions } from './confirm';
import { alertAsync as alertAsyncWeb, confirmAsync as confirmAsyncWeb } from './confirm.web';

interface AlertArgs {
  text?: string;
  style?: string;
  onPress?: () => void;
}

function lastAlertButtons(): AlertArgs[] {
  const call = vi.mocked(Alert.alert).mock.calls.at(-1);
  return (call?.[2] ?? []) as AlertArgs[];
}

const REMOVE: ConfirmOptions = {
  title: 'Remove this bet?',
  message: 'Chiefs moneyline',
  confirmLabel: 'Remove',
  cancelLabel: 'Cancel',
  destructive: true,
};

describe('confirmAsync native', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls Alert.alert with the same button text and styles as the old confirms', async () => {
    const cases: { options: ConfirmOptions; confirmStyle?: 'destructive' }[] = [
      { options: REMOVE, confirmStyle: 'destructive' },
      {
        options: {
          title: 'Disconnect league?',
          message: 'Remove "Home League" from Pivot?',
          confirmLabel: 'Disconnect',
          cancelLabel: 'Cancel',
          destructive: true,
        },
        confirmStyle: 'destructive',
      },
      {
        options: {
          title: 'Delete account?',
          message:
            'This permanently deletes your account, leagues, and lineup data. This cannot be undone.',
          confirmLabel: 'Delete',
          cancelLabel: 'Cancel',
          destructive: true,
        },
        confirmStyle: 'destructive',
      },
      {
        options: {
          title: 'League limit reached',
          message: 'Free accounts can connect three leagues.',
          confirmLabel: 'Upgrade',
          cancelLabel: 'Not now',
        },
      },
      {
        options: {
          title: 'Notifications are off',
          message: 'Turn on notifications for Pivot in the Settings app, then try again.',
          confirmLabel: 'Open Settings',
          cancelLabel: 'Not now',
        },
      },
    ];

    for (const { options, confirmStyle } of cases) {
      vi.mocked(Alert.alert).mockClear();
      const pending = confirmAsync(options);
      expect(Alert.alert).toHaveBeenCalledTimes(1);
      expect(Alert.alert).toHaveBeenCalledWith(options.title, options.message, [
        expect.objectContaining({ text: options.cancelLabel, style: 'cancel' }),
        confirmStyle === undefined
          ? expect.not.objectContaining({ style: expect.anything() })
          : expect.objectContaining({ text: options.confirmLabel, style: confirmStyle }),
      ]);
      const buttons = lastAlertButtons();
      expect(buttons[0]?.text).toBe(options.cancelLabel);
      expect(buttons[1]?.text).toBe(options.confirmLabel);
      buttons[1]?.onPress?.();
      await expect(pending).resolves.toBe(true);
    }
  });

  it('resolves false when the cancel button is pressed', async () => {
    const pending = confirmAsync(REMOVE);
    lastAlertButtons()[0]?.onPress?.();
    await expect(pending).resolves.toBe(false);
  });
});

describe('confirmAsync web', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves true when window.confirm accepts', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('window', { confirm });

    await expect(confirmAsyncWeb(REMOVE)).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledWith('Remove this bet?\n\nChiefs moneyline');
  });

  it('resolves false when window.confirm cancels', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('window', { confirm });

    await expect(confirmAsyncWeb(REMOVE)).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledWith('Remove this bet?\n\nChiefs moneyline');
  });
});

describe('alertAsync', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows a single OK button on native when none is passed', async () => {
    const pending = alertAsync('Could not remove', 'Try again.');
    expect(Alert.alert).toHaveBeenCalledWith('Could not remove', 'Try again.', [
      expect.objectContaining({ text: 'OK' }),
    ]);
    lastAlertButtons()[0]?.onPress?.();
    await expect(pending).resolves.toBeUndefined();
  });

  it('keeps a custom native button and runs its onPress', async () => {
    const onPress = vi.fn();
    const pending = alertAsync(
      'You are Pro',
      'Unlimited leagues and multi-lineup watching are unlocked.',
      [{ text: 'Done', onPress }],
    );
    expect(Alert.alert).toHaveBeenCalledWith(
      'You are Pro',
      'Unlimited leagues and multi-lineup watching are unlocked.',
      [expect.objectContaining({ text: 'Done' })],
    );
    lastAlertButtons()[0]?.onPress?.();
    expect(onPress).toHaveBeenCalledTimes(1);
    await expect(pending).resolves.toBeUndefined();
  });

  it('uses window.alert on web and then runs the button', async () => {
    const alert = vi.fn();
    vi.stubGlobal('window', { alert });
    const onPress = vi.fn();

    await alertAsyncWeb(
      'You are Pro',
      'Unlimited leagues and multi-lineup watching are unlocked.',
      [{ text: 'Done', onPress }],
    );

    expect(alert).toHaveBeenCalledWith(
      'You are Pro\n\nUnlimited leagues and multi-lineup watching are unlocked.',
    );
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
