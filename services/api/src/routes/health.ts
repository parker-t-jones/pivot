import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { webPushStatus } from '../lib/vapidConfig.js';

/**
 * Liveness probe for Fly / orchestrators. No auth, no DB, no Redis — a failing dependency
 * must not flap the process out of the load balancer (use a separate readiness check later
 * if needed).
 */
const healthRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/health',
    {
      schema: {
        response: {
          200: z.object({
            ok: z.literal(true),
            version: z.string(),
            webPush: z.enum(['enabled', 'disabled']),
          }),
        },
      },
    },
    async () => ({
      ok: true as const,
      version: process.env['GIT_SHA'] ?? 'dev',
      webPush: webPushStatus(process.env),
    }),
  );
};

export default healthRoutes;
