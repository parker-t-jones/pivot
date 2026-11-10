import { supabase } from './supabase';
import { setAccountNotFoundNotice } from './accountNotFoundNotice';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

/** Mirrors `services/api`'s `{ error: { code, message, details? } }` (Section 9 "Conventions —
 *  Error format") so callers can branch on `code` the same way the backend's own routes do. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
}

const ACCOUNT_NOT_FOUND_MESSAGE = "Your account isn't available anymore. Please sign in again.";

/**
 * `401 account_not_found` (services/api/src/lib/errors.ts) means the session's JWT is still
 * signature-valid but the account behind it is gone — most often the user deleted their account
 * from another tab/device. JWTs are stateless, so this client has no way to know until a request
 * fails this way. Clear the stored session immediately rather than letting the caller retry or
 * show a generic error: `supabase.auth.signOut()` fires `onAuthStateChange('SIGNED_OUT')`, which
 * `SessionContext` already turns into `session = null`, and `_layout.tsx`'s existing auth redirect
 * already sends a session-less user to `/(auth)/welcome` — no new redirect/error-boundary needed.
 * The explanation is stashed in `accountNotFoundNotice` for that screen to show once.
 */
async function throwIfErrorResponse(status: number, parsedBody: unknown): Promise<never> {
  const errorBody =
    parsedBody && typeof parsedBody === 'object' && 'error' in parsedBody
      ? (parsedBody as { error: { code?: string; message?: string; details?: unknown } }).error
      : null;

  if (status === 401 && errorBody?.code === 'account_not_found') {
    setAccountNotFoundNotice(errorBody.message ?? ACCOUNT_NOT_FOUND_MESSAGE);
    await supabase.auth.signOut();
  }

  throw new ApiRequestError(
    status,
    errorBody?.code ?? 'unknown_error',
    errorBody?.message ?? `Request failed with status ${status}.`,
    errorBody?.details,
  );
}

/**
 * Sprint 6 Phase 5 — the one place every authenticated request goes through, per decision #1
 * ("do not scatter fetch calls with manual header construction"). Reads the JWT fresh from the
 * Supabase session on every call (rather than a token passed in by the caller) so a refreshed
 * token is always used automatically — `supabase-js`'s `autoRefreshToken` (already configured in
 * `lib/supabase.ts`) keeps `getSession()` current without this module needing to know about it.
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!API_BASE_URL) {
    throw new Error(
      'Missing EXPO_PUBLIC_API_BASE_URL env var. Set it in app/.env (see .env.example).',
    );
  }

  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !data.session) {
    throw new ApiRequestError(401, 'unauthenticated', 'No active Supabase session.');
  }

  // Only set Content-Type when a body is sent. Fastify 5 rejects empty bodies with
  // `Content-Type: application/json` (FST_ERR_CTP_EMPTY_JSON_BODY) — which is exactly
  // what DELETE /leagues/:id (and other no-body calls) used to trigger.
  const headers: Record<string, string> = {
    Authorization: `Bearer ${data.session.access_token}`,
  };
  const hasBody = options.body !== undefined;
  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });

  // 204/205 must not be JSON-parsed — empty bodies (and RN quirks around reading them) previously
  // surfaced disconnect/delete as false failures even when the server succeeded.
  if (response.status === 204 || response.status === 205) {
    if (!response.ok) {
      await throwIfErrorResponse(response.status, null);
    }
    return undefined as T;
  }

  const rawBody = await response.text();
  const trimmed = rawBody.trim();
  let parsedBody: unknown = null;
  if (trimmed.length > 0) {
    try {
      parsedBody = JSON.parse(trimmed) as unknown;
    } catch {
      if (!response.ok) {
        await throwIfErrorResponse(response.status, null);
      }
      throw new ApiRequestError(
        response.status,
        'invalid_json',
        'Response was not valid JSON.',
      );
    }
  }

  if (!response.ok) {
    await throwIfErrorResponse(response.status, parsedBody);
  }

  return parsedBody as T;
}

export const apiClient = {
  get: <T>(path: string): Promise<T> => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown): Promise<T> => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'DELETE', body }),
};
