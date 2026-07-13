import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { ApiError, toErrorBody } from '../lib/errors.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
}

/** Throws (rather than a forbidden `!` assertion) if called on a route missing `fastify.authenticate`. */
export function requireUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.user) {
    throw new ApiError(401, 'unauthorized', 'Missing Authorization bearer token.');
  }
  return request.user;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Verifies a raw JWT string and returns the user, or throws. Exposed so callers with a token
     *  from somewhere other than the `Authorization` header (e.g. the `/v1/realtime` WebSocket
     *  upgrade's `?token=` query param, Phase 4) reuse this plugin's HS256/JWKS logic rather than
     *  re-implementing it. */
    verifyAuthToken: (token: string) => Promise<AuthenticatedUser>;
  }
  interface FastifyRequest {
    user: AuthenticatedUser | null;
  }
}

interface AuthPluginOptions {
  /** Legacy shared secret, still issued for some projects/tokens (Supabase "JWT secret"). */
  jwtSecret: string;
  /** Used to build the JWKS URL for projects on Supabase's newer asymmetric signing keys. */
  supabaseUrl: string;
}

/**
 * Validates the Supabase-issued JWT on `Authorization: Bearer <jwt>` and attaches
 * `request.user` (Section 9 "Conventions — Auth"). Exposes `fastify.authenticate` as a
 * `preHandler` for routes that require an authenticated user.
 *
 * Supabase projects (including a fresh local `supabase start`) may issue JWTs signed either
 * with the legacy shared secret (`alg: HS256`) or with an asymmetric signing key
 * (`alg: ES256`/`RS256`) — see https://supabase.com/docs/guides/auth/signing-keys. This
 * verifies HS256 tokens against `jwtSecret` and everything else against the project's JWKS.
 */
export default fp<AuthPluginOptions>(async (fastify, options) => {
  const secretKey = new TextEncoder().encode(options.jwtSecret);
  const jwks: JWTVerifyGetKey = createRemoteJWKSet(
    new URL('/auth/v1/.well-known/jwks.json', options.supabaseUrl),
  );

  async function verifyToken(token: string): Promise<AuthenticatedUser> {
    const { alg } = decodeProtectedHeader(token);
    const { payload } =
      alg === 'HS256' ? await jwtVerify(token, secretKey) : await jwtVerify(token, jwks);
    const userId = typeof payload.sub === 'string' ? payload.sub : null;
    const email = typeof payload['email'] === 'string' ? payload['email'] : null;
    if (!userId || !email) {
      throw new Error('JWT payload missing sub/email.');
    }
    return { id: userId, email };
  }

  fastify.decorateRequest('user', null);
  fastify.decorate('verifyAuthToken', verifyToken);

  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;

    if (!token) {
      const error = new ApiError(401, 'unauthorized', 'Missing Authorization bearer token.');
      await reply.status(error.statusCode).send(toErrorBody(error));
      return;
    }

    try {
      request.user = await verifyToken(token);
    } catch {
      const error = new ApiError(401, 'unauthorized', 'Invalid or expired token.');
      await reply.status(error.statusCode).send(toErrorBody(error));
    }
  });
});
