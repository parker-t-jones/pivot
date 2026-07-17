import { rankBroadcasts, type GameBroadcastOption } from '@fantasy-focus/dispatcher';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import { requireUser } from '../plugins/auth.js';
import '../plugins/services.js';

const gamesRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  /**
   * PLAN.md Section 9 `GET /games/:id/broadcasts` — the game's broadcast sources annotated by the
   * caller's app presence. Presentation only (the full ranked list), so it uses `rankBroadcasts`
   * directly (Section 2's `BroadcastResolver`); it is NOT the timing-critical switch recommendation
   * (that's `delivery.ts`, kept consistent with the fire-time source). Follows the `flags.ts`/
   * `session.ts` pattern: Supabase I/O here, pure ranking in the dispatcher package.
   *
   * `user_has_subscription` is derived from `user_app_presence.has_subscription = true` (a presence
   * row with `has_subscription = false` means the user knows about the service but can't watch it, so
   * it does not make a paid broadcast eligible).
   */
  fastify.get(
    '/games/:id/broadcasts',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request) => {
      const user = requireUser(request);
      const { id: gameId } = request.params;

      const { data: game, error: gameError } = await fastify.supabase
        .from('games')
        .select('id')
        .eq('id', gameId)
        .maybeSingle();
      if (gameError) throw gameError;
      if (!game) {
        throw new ApiError(404, 'game_not_found', 'No game exists with that id.');
      }

      const { data: broadcastRows, error: broadcastsError } = await fastify.supabase
        .from('game_broadcasts')
        .select('service, deep_link_url, requires_subscription')
        .eq('game_id', gameId);
      if (broadcastsError) throw broadcastsError;

      const { data: presenceRows, error: presenceError } = await fastify.supabase
        .from('user_app_presence')
        .select('service, has_subscription')
        .eq('user_id', user.id);
      if (presenceError) throw presenceError;

      const subscribedServices = new Set(
        (presenceRows ?? []).filter((row) => row.has_subscription).map((row) => row.service),
      );

      const broadcasts: GameBroadcastOption[] = (broadcastRows ?? []).map((row) => ({
        service: row.service,
        deepLinkUrl: row.deep_link_url,
        requiresSubscription: row.requires_subscription,
      }));

      const ranked = rankBroadcasts(broadcasts, subscribedServices);

      return {
        game_id: gameId,
        broadcasts: ranked.map((b) => ({
          service: b.service,
          deep_link_url: b.deepLinkUrl,
          requires_subscription: b.requiresSubscription,
          user_has_subscription: b.userHasSubscription,
          typical_lag_seconds: b.typicalLagSeconds,
          preferred: b.preferred,
        })),
      };
    },
  );
};

export default gamesRoutes;
