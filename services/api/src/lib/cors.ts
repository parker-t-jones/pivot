import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

/** Production browser origin. The local dev origin comes from `WEB_DEV_ORIGIN`, not from this file. */
export const PRODUCTION_WEB_ORIGIN = 'https://app.pivot-sports.app';

export function allowedWebOrigins(webDevOrigin: string | undefined): string[] {
  if (!webDevOrigin) return [PRODUCTION_WEB_ORIGIN];
  return [PRODUCTION_WEB_ORIGIN, webDevOrigin];
}

/**
 * Browser clients send `Origin` and an `Authorization` preflight. The iOS app sends neither, so a
 * missing `Origin` gets no CORS headers and the request continues.
 */
export async function registerWebCors(fastify: FastifyInstance, webDevOrigin: string | undefined) {
  await fastify.register(cors, {
    origin: allowedWebOrigins(webDevOrigin),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });
}
