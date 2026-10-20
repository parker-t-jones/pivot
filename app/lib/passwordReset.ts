import { PASSWORD_MIN_LENGTH } from './passwordPolicy';

export const PRODUCTION_RESET_URL = 'https://app.pivot-sports.app/reset-password';

/** Local web ports for this worktree. U9d-2 uses 8082–8083. */
export const LOCAL_RESET_ORIGINS = [
  'http://localhost:8084',
  'http://127.0.0.1:8084',
  'http://localhost:8085',
  'http://127.0.0.1:8085',
] as const;

export const RESET_EMAIL_SENT = 'If an account exists for that email, we sent a reset link.';

export const RESET_RATE_LIMIT_MESSAGE = 'Too many reset emails. Wait a minute and try again.';

export const RESET_NETWORK_MESSAGE =
  'Could not reach the server. Check your connection and try again.';

export const RESET_LINK_INVALID = 'This reset link is invalid or has expired.';

export const PASSWORD_UPDATED = 'Password updated';

export const PASSWORD_UPDATED_OTHER_DEVICE =
  'You can sign in with this password on your other devices.';

export const RESEND_COOLDOWN_MS = 60_000;

export const RECOVERY_READY_KEY = 'pivot.passwordRecovery';

export const RECOVERY_TOKENS_KEY = 'pivot.passwordRecovery.tokens';

export function passwordResetRedirectTo(input: {
  platform: string;
  locationOrigin?: string | null;
  supabaseUrl?: string | null;
  localWebOrigin?: string;
}): string {
  if (input.platform === 'web' && input.locationOrigin) {
    return `${input.locationOrigin.replace(/\/$/, '')}/reset-password`;
  }
  const supabaseUrl = input.supabaseUrl ?? '';
  const local = supabaseUrl.includes('127.0.0.1') || supabaseUrl.includes('localhost');
  if (local) {
    const origin = (input.localWebOrigin ?? LOCAL_RESET_ORIGINS[0]).replace(/\/$/, '');
    return `${origin}/reset-password`;
  }
  return PRODUCTION_RESET_URL;
}

export function resendCooldownRemaining(sentAt: number | null, now: number): number {
  if (sentAt == null) return 0;
  const remainingMs = sentAt + RESEND_COOLDOWN_MS - now;
  if (remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / 1000);
}

export type ResetEmailOutcome = 'sent' | 'rate_limit' | 'network' | 'failed';

export function classifyResetEmailError(
  error: { message: string; status?: number } | null,
): ResetEmailOutcome {
  if (!error) return 'sent';
  const message = error.message.toLowerCase();
  if (
    error.status === 429 ||
    message.includes('rate limit') ||
    message.includes('only request this') ||
    message.includes('too many') ||
    message.includes('over_email_send_rate_limit')
  ) {
    return 'rate_limit';
  }
  if (
    message.includes('network') ||
    message.includes('failed to fetch') ||
    message.includes('fetch failed') ||
    message.includes('network request failed')
  ) {
    return 'network';
  }
  // GoTrue sometimes names a missing account. The screen must not.
  if (
    message.includes('user not found') ||
    message.includes('email not found') ||
    message.includes('no user') ||
    message.includes('signups not allowed')
  ) {
    return 'sent';
  }
  return 'failed';
}

export function resetEmailOutcomeMessage(outcome: ResetEmailOutcome): string {
  if (outcome === 'sent') return RESET_EMAIL_SENT;
  if (outcome === 'rate_limit') return RESET_RATE_LIMIT_MESSAGE;
  if (outcome === 'network') return RESET_NETWORK_MESSAGE;
  return 'Could not send the reset email. Try again.';
}

export type RecoveryLink =
  | { status: 'ready'; accessToken: string; refreshToken: string }
  | { status: 'invalid' }
  | { status: 'missing' };

function firstParam(source: URLSearchParams, key: string): string | null {
  const value = source.get(key);
  return value && value.length > 0 ? value : null;
}

/**
 * Address to leave in the bar after a recovery link is handled.
 * Drops `#access_token…` on success and `#error=…` when the link is expired.
 */
export function recoveryUrlWithoutHash(href: string): string {
  const url = new URL(href);
  return `${url.pathname}${url.search}`;
}

/**
 * Implicit-flow recovery links land as `#access_token&refresh_token&type=recovery`.
 * The app client leaves `flowType` at the library default (`implicit`) and
 * `detectSessionInUrl: false`, so this parser — not the client — reads the hash.
 * A `?code=` link is PKCE and cannot be exchanged in a browser that did not
 * request the email, so it is treated as invalid.
 */
export function parseRecoveryLink(href: string): RecoveryLink {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
  const query = url.searchParams;
  const error =
    firstParam(hash, 'error') ??
    firstParam(hash, 'error_code') ??
    firstParam(query, 'error') ??
    firstParam(query, 'error_code');
  if (error) return { status: 'invalid' };

  const accessToken = firstParam(hash, 'access_token');
  const refreshToken = firstParam(hash, 'refresh_token');
  const type = firstParam(hash, 'type') ?? firstParam(query, 'type');
  if (accessToken && refreshToken && type === 'recovery') {
    return { status: 'ready', accessToken, refreshToken };
  }
  if (firstParam(query, 'code') || firstParam(hash, 'code')) return { status: 'invalid' };
  return { status: 'missing' };
}

export interface RecoveryStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export type RecoveryAttempt =
  | { phase: 'invalid' }
  | { phase: 'form' }
  | { phase: 'checking'; accessToken: string; refreshToken: string };

function storedTokens(
  storage: RecoveryStorage,
): { accessToken: string; refreshToken: string } | null {
  const raw = storage.getItem(RECOVERY_TOKENS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { accessToken?: unknown; refreshToken?: unknown };
    if (typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string') {
      if (parsed.accessToken.length > 0 && parsed.refreshToken.length > 0) {
        return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function readRecoveryAttempt(href: string, storage: RecoveryStorage): RecoveryAttempt {
  if (storage.getItem(RECOVERY_READY_KEY) === '1') return { phase: 'form' };
  const link = parseRecoveryLink(href);
  if (link.status === 'invalid') {
    storage.removeItem(RECOVERY_TOKENS_KEY);
    return { phase: 'invalid' };
  }
  if (link.status === 'ready') {
    const tokens = { accessToken: link.accessToken, refreshToken: link.refreshToken };
    storage.setItem(RECOVERY_TOKENS_KEY, JSON.stringify(tokens));
    return { phase: 'checking', ...tokens };
  }
  const saved = storedTokens(storage);
  if (saved) return { phase: 'checking', ...saved };
  return { phase: 'invalid' };
}

let recoveryConsume: Promise<boolean> | null = null;

export function resetRecoveryConsumeForTests(): void {
  recoveryConsume = null;
}

/**
 * One in-flight exchange. React strict mode mounts twice; a second
 * `setSession` with the same refresh token fails after rotation.
 */
export function consumeRecoverySession(
  tokens: { accessToken: string; refreshToken: string },
  setSession: (tokens: {
    access_token: string;
    refresh_token: string;
  }) => Promise<{ error: { message: string } | null }>,
): Promise<boolean> {
  if (recoveryConsume) return recoveryConsume;
  recoveryConsume = setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  }).then(({ error }) => {
    if (error) {
      recoveryConsume = null;
      return false;
    }
    return true;
  });
  return recoveryConsume;
}

export function markRecoveryReady(storage: RecoveryStorage): void {
  storage.removeItem(RECOVERY_TOKENS_KEY);
  storage.setItem(RECOVERY_READY_KEY, '1');
}

export function clearRecoveryAttempt(storage: RecoveryStorage): void {
  storage.removeItem(RECOVERY_TOKENS_KEY);
  storage.removeItem(RECOVERY_READY_KEY);
}

export const WEAK_PASSWORD_MESSAGE = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
