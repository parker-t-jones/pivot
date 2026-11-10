import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

/** `{ error: { code, message, details? } }` (Section 9 "Conventions — Error format"). */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function toErrorBody(error: ApiError): {
  error: { code: string; message: string; details?: unknown };
} {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    },
  };
}

/**
 * Thrown in place of a raw Postgrest error when a `.single()` lookup of the *authenticated
 * caller's own* `public.users` row (keyed by `requireUser(request).id`) comes back with zero
 * rows. That specific shape — `error.code === 'PGRST116'` ("JSON object requested, ... 0 rows") —
 * means the account was deleted (or its row otherwise removed) after a still-valid JWT was
 * issued: JWTs are stateless, so `fastify.authenticate` (services/api/src/plugins/auth.ts) only
 * verifies the signature/claims and has no way to know the row is gone. `apiErrorHandler` below
 * turns this into a clean `401 account_not_found` instead of an opaque 500.
 *
 * Deliberately a distinct class, not a blanket "any PGRST116 is this" rule in the handler: a
 * `.single()` call elsewhere (e.g. a leagues/stakes/picks row looked up by its own id, already
 * ownership-checked) going to 0 rows is a different, genuinely-unexpected bug and should stay a
 * 500 — see `rethrowIfOwnAccountRowMissing` below, which is the only place this gets thrown, and
 * only for a caller's-own-`users`-row lookup.
 */
export class OwnAccountRowMissingError extends Error {
  constructor() {
    super('The authenticated user has no public.users row.');
  }
}

/**
 * Call this (instead of a bare `if (error) throw error`) at every call site that does a
 * `.single()` (or an update's `.select().single()`) lookup of the caller's own `users` row keyed
 * by `requireUser(request).id`. Turns Postgrest's "0 rows" shape into `OwnAccountRowMissingError`
 * so `apiErrorHandler` reports `401 account_not_found` instead of a raw 500 — one shared check,
 * applied only at call sites that opt in, rather than a per-route patch or a blanket PGRST116 rule.
 * Not for a `.single()`/`.maybeSingle()` on any other table or row.
 */
export function rethrowIfOwnAccountRowMissing(error: { code?: string } | null): void {
  if (error?.code === 'PGRST116') {
    throw new OwnAccountRowMissingError();
  }
}

/**
 * Shared Fastify error handler: Zod → 400, ApiError → its status, FastifyError with a
 * real `statusCode` (≥400) → that status (so framework 4xxs aren't flattened to 500),
 * everything else → opaque 500.
 */
export function apiErrorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (hasZodFastifySchemaValidationErrors(error)) {
    reply.status(400).send({
      error: {
        code: 'validation_error',
        message: 'Request validation failed.',
        details: error.validation,
      },
    });
    return;
  }
  if (error instanceof ApiError) {
    reply.status(error.statusCode).send(toErrorBody(error));
    return;
  }

  if (error instanceof OwnAccountRowMissingError) {
    reply.status(401).send({
      error: {
        code: 'account_not_found',
        message: "Your account isn't available anymore. Please sign in again.",
      },
    });
    return;
  }

  const statusCode =
    typeof error.statusCode === 'number' && error.statusCode >= 400 ? error.statusCode : 500;

  if (statusCode >= 500) {
    request.log.error(error);
    reply.status(500).send({ error: { code: 'internal_error', message: 'Internal server error.' } });
    return;
  }

  request.log.warn(error);
  reply.status(statusCode).send({
    error: {
      code: typeof error.code === 'string' ? error.code : 'request_error',
      message: error.message,
    },
  });
}
