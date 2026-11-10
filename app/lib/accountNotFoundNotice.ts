/**
 * Issue #46 — when the API returns `401 account_not_found` (the caller's own `public.users` row
 * is gone, e.g. the account was deleted from another tab/device while this session's Supabase
 * JWT was still valid — JWTs are stateless, so they outlive the row), `apiClient.ts`'s shared
 * `request()` clears the stored session and stashes the explanation here before throwing, rather
 * than letting the caller silently retry or show a generic error screen. The welcome screen
 * (where `_layout.tsx`'s auth redirect lands once the session clears) reads and clears it once,
 * so the message shows exactly one time and never lingers across an unrelated later sign-out.
 *
 * Plain module state, not storage: this only needs to survive the redirect that happens in the
 * same JS session right after the session is cleared, same instance on native and web.
 */
let pendingMessage: string | null = null;

export function setAccountNotFoundNotice(message: string): void {
  pendingMessage = message;
}

export function consumeAccountNotFoundNotice(): string | null {
  const message = pendingMessage;
  pendingMessage = null;
  return message;
}
