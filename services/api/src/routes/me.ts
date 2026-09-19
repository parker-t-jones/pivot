import { parsePreferences } from '@pivot/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import { requireUser } from '../plugins/auth.js';
import '../plugins/services.js';

/** Same enum backing `user_app_presence.service`'s `is_valid_streaming_service` DB check
 *  (`supabase/migrations/20260510120000_users_user_app_presence.sql`) — kept in sync by hand, same
 *  pattern as `flags.ts`'s `FLAG_USER_ACTIONS` constant relative to its own DB check constraint. */
const STREAMING_SERVICES = [
  'sunday_ticket',
  'espn_plus',
  'paramount_plus',
  'peacock',
  'amazon_prime',
  'nfl_plus',
  'nfl_network',
  'hulu',
  'fubo',
  'directv',
  'fox',
  'cbs',
  'nbc',
  'abc',
] as const;

/**
 * Expo push tokens are either the current `ExponentPushToken[...]` or the legacy `ExpoPushToken[...]`
 * (Sprint 6 Phase 4 spec) — deliberately narrower than `expo-server-sdk`'s own `Expo.isExpoPushToken`,
 * which also accepts a bare UUID (a legacy device-id format this endpoint doesn't want to accept from
 * a client body). Checked here, at the boundary, so a malformed token never reaches `users.expo_push_token`
 * — `deliverFlagEvent` (dispatcher) also validates before send, but failing fast here gives the client an
 * immediate, actionable error instead of a silent push failure minutes later.
 */
const EXPO_PUSH_TOKEN_PATTERN = /^Expo(nent)?PushToken\[.+\]$/;

/** Both real platforms so a genuinely bad value (e.g. `platform: 'web'`) still gets the generic
 *  `validation_error` from schema validation — `'android'` is a real platform this endpoint just
 *  doesn't support yet, so it earns its own `unsupported_platform` code past that gate. */
const PLATFORMS = ['ios', 'android'] as const;

const registerPushTokenBody = z.object({
  token: z.string().min(1),
  platform: z.enum(PLATFORMS),
});

interface PushTokenRow {
  expo_push_token: string | null;
}

function pushTokenResponse(row: PushTokenRow | null) {
  return { expo_push_token: row?.expo_push_token ?? null };
}

interface UserRowForMe {
  id: string;
  email: string;
  preferences: unknown;
  subscription_tier: string;
}

interface AppPresenceRow {
  service: string;
  has_subscription: boolean;
}

function meResponse(user: UserRowForMe, appPresence: AppPresenceRow[]) {
  return {
    user_id: user.id,
    email: user.email,
    subscription_tier: user.subscription_tier,
    preferences: parsePreferences(user.preferences),
    app_presence: appPresence.map((row) => ({
      service: row.service,
      has_subscription: row.has_subscription,
    })),
  };
}

/** Hand-written partial mirror of `preferencesSchema` (zod v4 dropped `.deepPartial()`) — every
 *  field, including `quietHours`'s sub-fields, is optional so a PATCH can touch just one leaf
 *  without the caller needing to resend the whole object. */
const preferencesPatchBody = z.object({
  notificationMode: z.enum(['all', 'high_leverage_only', 'off']).optional(),
  quietHours: z
    .object({
      enabled: z.boolean().optional(),
      startHour: z.number().int().min(0).max(23).optional(),
      endHour: z.number().int().min(0).max(23).optional(),
      timezone: z.string().optional(),
    })
    .optional(),
  autoSwitch: z.boolean().optional(),
});

const appPresenceBody = z.object({
  services: z
    .array(
      z.object({
        service: z.enum(STREAMING_SERVICES),
        has_subscription: z.boolean(),
      }),
    )
    .min(1),
});

/** PLAN.md Section 9 `POST /me/push-token` / `DELETE /me/push-token`, plus the `GET /me`,
 *  `PATCH /me/preferences`, `POST /me/app-presence`, and `DELETE /me` routes the Section 9 spec
 *  also lists under this same resource — added in Sprint 9 Phase 2 alongside the Settings screen
 *  that's their only client (see report: these four didn't exist at all before this phase, which
 *  is a discovery worth flagging even though it's server work in a phase framed as "client-side"). */
const meRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  /** "Get current user + preferences" (Section 9) — also folds in `user_app_presence` so Settings'
   *  Streaming services section and the reason chip/color-flash's "does this user have a
   *  subscription" question (Section 8's `shouldRateLimit`/broadcast ranking already reads this
   *  table server-side; this is the client's own read path for the same rows). */
  fastify.get('/me', async (request) => {
    const user = requireUser(request);

    const { data: userRow, error: userError } = await fastify.supabase
      .from('users')
      .select('id, email, preferences, subscription_tier')
      .eq('id', user.id)
      .single();
    if (userError) throw userError;

    const { data: presenceRows, error: presenceError } = await fastify.supabase
      .from('user_app_presence')
      .select('service, has_subscription')
      .eq('user_id', user.id);
    if (presenceError) throw presenceError;

    return meResponse(userRow, presenceRows ?? []);
  });

  /**
   * Partial preferences update — merges the body over the caller's *current* stored preferences
   * (not `preferencesSchema`'s bare defaults) so, e.g., patching `quietHours.enabled` alone doesn't
   * silently reset `notificationMode` to `'all'`. `parsePreferences` re-validates the merged result,
   * which also backfills any key an older stored row predates (Section 7's "every existing row
   * parses to the defaults" invariant, extended to a merge instead of a fresh parse).
   */
  fastify.patch(
    '/me/preferences',
    { schema: { body: preferencesPatchBody } },
    async (request) => {
      const user = requireUser(request);

      const { data: existingRow, error: existingError } = await fastify.supabase
        .from('users')
        .select('preferences')
        .eq('id', user.id)
        .single();
      if (existingError) throw existingError;

      const current = parsePreferences(existingRow.preferences);
      const merged = parsePreferences({
        ...current,
        ...request.body,
        quietHours: { ...current.quietHours, ...request.body.quietHours },
      });

      const { data, error } = await fastify.supabase
        .from('users')
        .update({ preferences: merged })
        .eq('id', user.id)
        .select('id, email, preferences, subscription_tier')
        .single();
      if (error) throw error;

      const { data: presenceRows, error: presenceError } = await fastify.supabase
        .from('user_app_presence')
        .select('service, has_subscription')
        .eq('user_id', user.id);
      if (presenceError) throw presenceError;

      return meResponse(data, presenceRows ?? []);
    },
  );

  /**
   * Upserts one or more streaming-service presence rows (Settings' "Streaming services" section
   * and onboarding step 4 both write through here) — `service` is constrained to the same enum as
   * the DB's `is_valid_streaming_service` check, so a bad value fails schema validation before ever
   * reaching Supabase. Bulk (`services: [...]`) rather than one-at-a-time so a user flipping several
   * toggles before leaving the screen costs one round trip, not N.
   */
  fastify.post('/me/app-presence', { schema: { body: appPresenceBody } }, async (request) => {
    const user = requireUser(request);
    const { services } = request.body;

    const { error } = await fastify.supabase.from('user_app_presence').upsert(
      services.map((s) => ({
        user_id: user.id,
        service: s.service,
        has_subscription: s.has_subscription,
      })),
      { onConflict: 'user_id,service' },
    );
    if (error) throw error;

    const { data: presenceRows, error: presenceError } = await fastify.supabase
      .from('user_app_presence')
      .select('service, has_subscription')
      .eq('user_id', user.id);
    if (presenceError) throw presenceError;

    return { app_presence: (presenceRows ?? []).map((row) => ({ ...row })) };
  });

  /**
   * Account deletion (Settings' Account section "danger zone"). Deletes the `auth.users` row via
   * the admin API rather than `public.users` directly — every one of this user's rows (`leagues`,
   * `lineup_slots`, `flag_events`, `viewing_sessions`, `user_app_presence`, and `public.users`
   * itself) cascades from `public.users.id REFERENCES auth.users (id) ON DELETE CASCADE` (Section 7),
   * which itself cascades from this single admin delete — no manual multi-table cleanup needed, and
   * no risk of a route change here drifting out of sync with the FK graph.
   */
  fastify.delete('/me', async (request, reply) => {
    const user = requireUser(request);
    const { error } = await fastify.supabase.auth.admin.deleteUser(user.id);
    if (error) {
      throw new ApiError(500, 'account_deletion_failed', error.message);
    }
    return reply.status(204).send();
  });

  /**
   * Register/update the caller's Expo push token (Sprint 6 Phase 4). `platform: 'android'` is
   * rejected with `unsupported_platform` — v1 is iOS-only. `updated_at` is NOT set here: Sprint 1's
   * `users_set_updated_at` trigger bumps it on any row update, including this single-column one
   * (verified against local Supabase — a targeted `expo_push_token`-only `UPDATE` does fire the
   * trigger), so setting it in application code would be redundant.
   */
  fastify.post('/me/push-token', { schema: { body: registerPushTokenBody } }, async (request) => {
    const user = requireUser(request);
    const { token, platform } = request.body;

    if (platform !== 'ios') {
      throw new ApiError(
        400,
        'unsupported_platform',
        `Push notifications are not yet supported on "${platform}" — only "ios" is accepted in v1.`,
      );
    }

    if (!EXPO_PUSH_TOKEN_PATTERN.test(token)) {
      throw new ApiError(
        400,
        'invalid_push_token',
        'Token is not a recognized Expo push token — expected "ExponentPushToken[...]" or "ExpoPushToken[...]".',
      );
    }

    const { data, error } = await fastify.supabase
      .from('users')
      .update({ expo_push_token: token })
      .eq('id', user.id)
      .select('expo_push_token')
      .single();
    if (error) throw error;

    return pushTokenResponse(data);
  });

  /** Unregister the caller's push token (called on sign-out, Phase 5) — a stale token left behind on
   *  a signed-out device would otherwise keep receiving pushes for a session that no longer exists. */
  fastify.delete('/me/push-token', async (request) => {
    const user = requireUser(request);

    const { data, error } = await fastify.supabase
      .from('users')
      .update({ expo_push_token: null })
      .eq('id', user.id)
      .select('expo_push_token')
      .single();
    if (error) throw error;

    return pushTokenResponse(data);
  });
};

export default meRoutes;
