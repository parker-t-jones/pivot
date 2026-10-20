import { describe, expect, it } from 'vitest';

import {
  changePasswordAfterLock,
  classifyBiometricError,
  classifyPasswordChangeError,
  deviceLockLevel,
  passwordChangeErrorMessage,
} from './changePassword';

describe('change password', () => {
  it('asks for the current password on web', () => {
    expect(
      changePasswordAfterLock({ platform: 'web', lock: 'biometric', biometric: 'success' }),
    ).toBe('current-password');
  });

  it('opens the new password after Face ID or passcode succeeds', () => {
    expect(deviceLockLevel(3)).toBe('biometric');
    expect(deviceLockLevel(1)).toBe('passcode');
    expect(
      changePasswordAfterLock({ platform: 'ios', lock: 'biometric', biometric: 'success' }),
    ).toBe('new-password');
    expect(
      changePasswordAfterLock({ platform: 'ios', lock: 'passcode', biometric: 'success' }),
    ).toBe('new-password');
  });

  it('stays put when Face ID is cancelled', () => {
    expect(classifyBiometricError('user_cancel')).toBe('cancel');
    expect(classifyBiometricError('authentication_failed')).toBe('cancel');
    expect(
      changePasswordAfterLock({ platform: 'ios', lock: 'biometric', biometric: 'cancel' }),
    ).toBe('cancelled');
  });

  it('falls back to the current password when biometrics and passcode are unavailable', () => {
    expect(deviceLockLevel(0)).toBe('none');
    expect(classifyBiometricError('not_enrolled')).toBe('unavailable');
    expect(classifyBiometricError('passcode_not_set')).toBe('unavailable');
    expect(changePasswordAfterLock({ platform: 'ios', lock: 'none' })).toBe('current-password');
    expect(
      changePasswordAfterLock({ platform: 'ios', lock: 'biometric', biometric: 'unavailable' }),
    ).toBe('current-password');
  });

  it('names a wrong current password, a weak password, and a network failure', () => {
    expect(classifyPasswordChangeError('Invalid login credentials')).toBe('wrong-current');
    expect(passwordChangeErrorMessage('wrong-current', 'Invalid login credentials')).toBe(
      'Current password is incorrect.',
    );
    expect(classifyPasswordChangeError('Password should be at least 8 characters.')).toBe('weak');
    expect(passwordChangeErrorMessage('weak', 'Password should be at least 8 characters.')).toBe(
      'Password must be at least 8 characters.',
    );
    expect(
      classifyPasswordChangeError('New password should be different from the old password.'),
    ).toBe('same');
    expect(classifyPasswordChangeError('anything', 'same_password')).toBe('same');
    expect(
      passwordChangeErrorMessage('same', 'New password should be different from the old password.'),
    ).toBe('New password must be different from your current password.');
    expect(classifyPasswordChangeError('Network request failed')).toBe('network');
    expect(passwordChangeErrorMessage('network', 'Network request failed')).toBe(
      'Could not reach the server. Check your connection and try again.',
    );
  });
});
