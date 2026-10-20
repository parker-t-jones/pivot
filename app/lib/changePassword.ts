export type DeviceLockLevel = 'none' | 'passcode' | 'biometric';

export type BiometricOutcome = 'success' | 'cancel' | 'unavailable';

export type ChangePasswordPhase = 'current-password' | 'new-password' | 'cancelled';

/** Maps `expo-local-authentication` `SecurityLevel` (0 none, 1 passcode, 2+ biometric). */
export function deviceLockLevel(securityLevel: number): DeviceLockLevel {
  if (securityLevel <= 0) return 'none';
  if (securityLevel === 1) return 'passcode';
  return 'biometric';
}

const UNAVAILABLE_ERRORS = new Set(['not_available', 'not_enrolled', 'passcode_not_set']);

export function classifyBiometricError(error: string): BiometricOutcome {
  if (UNAVAILABLE_ERRORS.has(error)) return 'unavailable';
  return 'cancel';
}

/**
 * Web always re-checks the current password. iOS uses Face ID / Touch ID, with
 * the device passcode allowed inside the system prompt. No biometrics and no
 * passcode falls through to the current password. Cancel does not.
 */
export function changePasswordAfterLock(input: {
  platform: string;
  lock: DeviceLockLevel;
  biometric?: BiometricOutcome;
}): ChangePasswordPhase {
  if (input.platform === 'web') return 'current-password';
  if (input.lock === 'none') return 'current-password';
  if (input.biometric === 'success') return 'new-password';
  if (input.biometric === 'unavailable') return 'current-password';
  return 'cancelled';
}

export type PasswordChangeFailure = 'wrong-current' | 'weak' | 'network' | 'reauth' | 'other';

export function classifyPasswordChangeError(message: string): PasswordChangeFailure {
  const lower = message.toLowerCase();
  if (
    lower.includes('network') ||
    lower.includes('failed to fetch') ||
    lower.includes('fetch failed') ||
    lower.includes('network request failed')
  ) {
    return 'network';
  }
  if (lower.includes('reauthenticat') || lower.includes('nonce')) return 'reauth';
  if (
    lower.includes('invalid login') ||
    lower.includes('invalid credentials') ||
    lower.includes('invalid email or password')
  ) {
    return 'wrong-current';
  }
  if (
    lower.includes('at least') ||
    lower.includes('weak') ||
    lower.includes('pwned') ||
    lower.includes('should be')
  ) {
    return 'weak';
  }
  return 'other';
}

export function passwordChangeErrorMessage(failure: PasswordChangeFailure, raw: string): string {
  if (failure === 'wrong-current') return 'Current password is incorrect.';
  if (failure === 'weak') return 'Password must be at least 6 characters.';
  if (failure === 'network')
    return 'Could not reach the server. Check your connection and try again.';
  if (failure === 'reauth') return 'Sign in again, then change your password.';
  return raw;
}
