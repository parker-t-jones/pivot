import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import '../plugins/services.js';

const PRO_ENTITLEMENT_ID = 'pro';

/** Events that grant or re-affirm Pro access. */
const GRANT_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'PRODUCT_CHANGE',
  'TEMPORARY_ENTITLEMENT_GRANT',
]);

/** Events that revoke Pro (access ended). Cancellation alone keeps access until EXPIRATION. */
const REVOKE_TYPES = new Set(['EXPIRATION', 'REFUND']);

const revenueCatEventSchema = z.object({
  api_version: z.string().optional(),
  event: z.object({
    type: z.string(),
    app_user_id: z.string().min(1),
    entitlement_ids: z.array(z.string()).nullable().optional(),
    entitlements: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional(),
  }),
});

function resolveTier(event: z.infer<typeof revenueCatEventSchema>['event']): 'pro' | 'free' | null {
  const entitlementIds = event.entitlement_ids ?? [];
  const hasProEntitlement =
    entitlementIds.includes(PRO_ENTITLEMENT_ID) ||
    (event.entitlements != null && PRO_ENTITLEMENT_ID in event.entitlements);

  if (REVOKE_TYPES.has(event.type)) {
    return 'free';
  }
  if (GRANT_TYPES.has(event.type)) {
    // PRODUCT_CHANGE may move off Pro — only grant when entitlement is present (or omitted).
    if (event.type === 'PRODUCT_CHANGE' && entitlementIds.length > 0 && !hasProEntitlement) {
      return 'free';
    }
    return 'pro';
  }
  // CANCELLATION / TRANSFER / TEST / etc. — no tier write unless entitlements clearly grant pro
  // on an unknown event type. Cancellation keeps access until EXPIRATION.
  if (event.type === 'CANCELLATION') {
    return null;
  }
  if (hasProEntitlement) return 'pro';
  return null;
}

/**
 * RevenueCat server notifications → `users.subscription_tier`.
 * Auth: `Authorization` header must equal `REVENUECAT_WEBHOOK_SECRET` (Bearer optional).
 */
const billingRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.post(
    '/billing/revenuecat',
    {
      schema: {
        body: revenueCatEventSchema,
        response: {
          200: z.object({ ok: z.literal(true), tier: z.enum(['pro', 'free']).nullable() }),
        },
      },
    },
    async (request) => {
      const expected = process.env['REVENUECAT_WEBHOOK_SECRET'];
      if (!expected) {
        throw new ApiError(503, 'billing_unconfigured', 'RevenueCat webhook secret is not configured.');
      }

      const header = request.headers.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : header;
      if (token !== expected) {
        throw new ApiError(401, 'unauthorized', 'Invalid RevenueCat webhook authorization.');
      }

      const { event } = request.body;
      const tier = resolveTier(event);
      if (tier === null) {
        request.log.info({ type: event.type }, 'RevenueCat event ignored (no tier change)');
        return { ok: true as const, tier: null };
      }

      const { error } = await fastify.supabase
        .from('users')
        .update({ subscription_tier: tier })
        .eq('id', event.app_user_id);

      if (error) {
        request.log.error(error, 'Failed to update subscription_tier from RevenueCat');
        throw new ApiError(500, 'internal_error', 'Failed to update subscription tier.');
      }

      return { ok: true as const, tier };
    },
  );
};

export default billingRoutes;

/** Exported for unit tests. */
export { resolveTier as resolveRevenueCatTier };
