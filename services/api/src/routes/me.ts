import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import { requireUser } from '../plugins/auth.js';
import '../plugins/services.js';

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

/** PLAN.md Section 9 `POST /me/push-token` / `DELETE /me/push-token`. */
const meRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

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
