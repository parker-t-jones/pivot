import { afterEach, describe, expect, it, vi } from 'vitest';

import { newPasswordIssue, newPasswordIssueMessage } from './passwordPolicy';
import {
  classifyResetEmailError,
  consumeRecoverySession,
  LOCAL_RESET_ORIGINS,
  passwordResetRedirectTo,
  PRODUCTION_RESET_URL,
  readRecoveryAttempt,
  resendCooldownRemaining,
  RESET_EMAIL_SENT,
  RESET_RATE_LIMIT_MESSAGE,
  resetEmailOutcomeMessage,
  resetRecoveryConsumeForTests,
  type RecoveryStorage,
} from './passwordReset';

function memoryStorage(): RecoveryStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

afterEach(() => {
  resetRecoveryConsumeForTests();
});

describe('forgot-password copy and cooldown', () => {
  it('uses the same sentence whether or not the account exists', () => {
    expect(resetEmailOutcomeMessage('sent')).toBe(RESET_EMAIL_SENT);
    expect(RESET_EMAIL_SENT).toBe('If an account exists for that email, we sent a reset link.');
    expect(classifyResetEmailError(null)).toBe('sent');
    expect(classifyResetEmailError({ message: 'User not found' })).toBe('sent');
    expect(classifyResetEmailError({ message: 'Email not found' })).toBe('sent');
  });

  it('names a rate limit and keeps resend disabled for 60 seconds', () => {
    expect(classifyResetEmailError({ message: 'Email rate limit exceeded', status: 429 })).toBe(
      'rate_limit',
    );
    expect(
      classifyResetEmailError({
        message: 'For security purposes, you can only request this once every 60 seconds',
      }),
    ).toBe('rate_limit');
    expect(resetEmailOutcomeMessage('rate_limit')).toBe(RESET_RATE_LIMIT_MESSAGE);

    const sentAt = 1_000;
    expect(resendCooldownRemaining(null, sentAt)).toBe(0);
    expect(resendCooldownRemaining(sentAt, sentAt)).toBe(60);
    expect(resendCooldownRemaining(sentAt, sentAt + 59_000)).toBe(1);
    expect(resendCooldownRemaining(sentAt, sentAt + 60_000)).toBe(0);
  });

  it('points local dev at the local origin and production at the hosted reset page', () => {
    expect(
      passwordResetRedirectTo({
        platform: 'web',
        locationOrigin: 'http://localhost:8084',
      }),
    ).toBe('http://localhost:8084/reset-password');
    expect(
      passwordResetRedirectTo({
        platform: 'ios',
        supabaseUrl: 'http://127.0.0.1:54321',
      }),
    ).toBe(`${LOCAL_RESET_ORIGINS[0]}/reset-password`);
    expect(
      passwordResetRedirectTo({
        platform: 'ios',
        supabaseUrl: 'https://taucqrptzfyzhfzpinzo.supabase.co',
      }),
    ).toBe(PRODUCTION_RESET_URL);
  });
});

describe('reset page states', () => {
  it('accepts an implicit recovery hash and rejects an expired or PKCE link', () => {
    const storage = memoryStorage();
    const ready = readRecoveryAttempt(
      'https://app.pivot-sports.app/reset-password#access_token=atk&refresh_token=rtk&type=recovery',
      storage,
    );
    expect(ready).toEqual({ phase: 'checking', accessToken: 'atk', refreshToken: 'rtk' });

    expect(
      readRecoveryAttempt(
        'https://app.pivot-sports.app/reset-password#error=access_denied&error_code=otp_expired&error_description=expired',
        memoryStorage(),
      ),
    ).toEqual({ phase: 'invalid' });
    expect(
      readRecoveryAttempt('https://app.pivot-sports.app/reset-password?code=abc', memoryStorage()),
    ).toEqual({ phase: 'invalid' });
    expect(
      readRecoveryAttempt('https://app.pivot-sports.app/reset-password', memoryStorage()),
    ).toEqual({ phase: 'invalid' });
  });

  it('keeps the form after the hash is cleared', () => {
    const storage = memoryStorage();
    readRecoveryAttempt(
      'https://app.pivot-sports.app/reset-password#access_token=atk&refresh_token=rtk&type=recovery',
      storage,
    );
    expect(readRecoveryAttempt('https://app.pivot-sports.app/reset-password', storage).phase).toBe(
      'checking',
    );
  });

  it('rejects a mismatch and a short password before calling updateUser', () => {
    expect(newPasswordIssue('short', 'short')).toBe('weak');
    expect(newPasswordIssueMessage('weak')).toBe('Password must be at least 6 characters.');
    expect(newPasswordIssue('longenough', 'different')).toBe('mismatch');
    expect(newPasswordIssueMessage('mismatch')).toBe('Passwords do not match.');
    expect(newPasswordIssue('longenough', 'longenough')).toBeNull();
  });

  it('exchanges the recovery session once', async () => {
    const setSession = vi.fn().mockResolvedValue({ error: null });
    const tokens = { accessToken: 'atk', refreshToken: 'rtk' };
    const [first, second] = await Promise.all([
      consumeRecoverySession(tokens, setSession),
      consumeRecoverySession(tokens, setSession),
    ]);
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(setSession).toHaveBeenCalledTimes(1);
  });
});
