import { supabase } from './supabase';
import { alertAsync } from './confirm';

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

/**
 * Issue #46: the server's `account_not_found` means the signed-in Supabase session outlived the
 * account it belongs to (the account was deleted, but the already-issued access token stays valid
 * until it naturally expires). There's nothing to retry — clear the session here, in the one place
 * every authenticated request goes through, so the root layout's existing session-based redirect
 * (`resolveRootAuthRedirect`) takes the user to sign-in on its own, and tell them why instead of
 * surfacing a generic error screen.
 */
async function throwIfErrorResponse(status: number, parsedBody: unknown): Promise<never> {
  const candidate =
    parsedBody && typeof parsedBody === 'object' && 'error' in parsedBody ? parsedBody.error : null;
  const errorBody =
    candidate &&
    typeof candidate === 'object' &&
    'code' in candidate &&
    typeof candidate.code === 'string'
      ? (candidate as { code: string; message?: string; details?: unknown })
      : null;

  if (status === 404 && !errorBody) {
    throw new ApiRequestError(
      status,
      'route_unavailable',
      "This isn't available yet. Please try again in a little while.",
    );
  }

  const code = errorBody?.code ?? 'unknown_error';
  const message = errorBody?.message ?? `Request failed with status ${status}.`;

  if (code === 'account_not_found') {
    await supabase.auth.signOut();
    void alertAsync("You're signed out", message);
  }

  throw new ApiRequestError(status, code, message, errorBody?.details);
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
      throw new ApiRequestError(response.status, 'invalid_json', 'Response was not valid JSON.');
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
