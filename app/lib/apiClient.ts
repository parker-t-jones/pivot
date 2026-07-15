import { supabase } from './supabase';

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

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.session.access_token}`,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const rawBody = await response.text();
  const parsedBody: unknown = rawBody.length > 0 ? JSON.parse(rawBody) : null;

  if (!response.ok) {
    const errorBody =
      parsedBody && typeof parsedBody === 'object' && 'error' in parsedBody
        ? (parsedBody as { error: { code?: string; message?: string; details?: unknown } }).error
        : null;
    throw new ApiRequestError(
      response.status,
      errorBody?.code ?? 'unknown_error',
      errorBody?.message ?? `Request failed with status ${response.status}.`,
      errorBody?.details,
    );
  }

  return parsedBody as T;
}

export const apiClient = {
  get: <T>(path: string): Promise<T> => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'DELETE', body }),
};
