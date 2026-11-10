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

/**
 * Call this in place of `throw error` wherever the Supabase error being thrown comes from a
 * `.single()`/`.maybeSingle()`-style lookup of the *signed-in caller's own* `public.users` row
 * (keyed by `requireUser(request).id`). PostgREST's "0 rows" code (`PGRST116`) there always means
 * the account was deleted after the JWT was issued — JWTs are stateless, so deletion revokes future
 * refreshes but not an access token already handed to the client — so it becomes a clean 401
 * `account_not_found` instead of a raw 500.
 *
 * This can't live in `apiErrorHandler` alone: a thrown `PostgrestError` carries only
 * `code`/`message`/`details`/`hint`, not which table or row produced it, and PGRST116 on an
 * unrelated lookup (a league, a stake) means something else entirely — translating every PGRST116
 * globally would wrongly turn those into "sign in again" too. So the table/column context has to
 * be supplied at the call site, which is why this is invoked there rather than centralized in the
 * handler.
 */
export function throwAsAccountNotFoundIfMissingRow(error: {
  code?: string | null;
  message: string;
}): never {
  if (error.code === 'PGRST116') {
    throw new ApiError(
      401,
      'account_not_found',
      "Your account isn't available anymore. Please sign in again.",
    );
  }
  throw error as Error;
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
