import type { ErrorReporter } from '@pivot/shared';

/**
 * Raised for ESPN-specific ingestion failures. No HTTP/`statusCode` coupling — `ApiError`
 * (`services/api/src/lib/errors.ts`) is API-owned and shaped around Fastify replies; this code
 * never runs anywhere near one.
 */
export class IngestionError extends Error {}

export interface ShapeFailureContext {
  /** ESPN event id the failing response was for. */
  eventId: string;
  /** What went wrong, in human terms — e.g. "response did not match the expected shape". */
  reason: string;
  /** The zod issues describing the mismatch, when there are any (absent for e.g. a header that
   *  parsed fine but didn't identify both teams). Kept as `unknown` so this file doesn't depend on
   *  zod's error-issue shape. */
  issues?: unknown;
}

/**
 * A malformed or incomplete ESPN response is an expected condition against an undocumented,
 * unofficial API (PLAN.md Section 5) — not a bug — so this logs and lets the caller skip the
 * affected play/cycle rather than throwing and crashing the poll loop.
 *
 * Both `console.error` (local dev visibility) and the injected `ErrorReporter` (production
 * alerting) run on every call; neither replaces the other — this is the addition the ESPN adapter
 * decoupling plan called for over the console-only logging first proposed.
 */
export function reportShapeFailure(reporter: ErrorReporter, context: ShapeFailureContext): void {
  console.error('[espn-ingestion] shape validation failed', context);

  const error = new IngestionError(
    `ESPN response shape mismatch (event ${context.eventId}): ${context.reason}`,
  );
  reporter.captureException(error, {
    eventId: context.eventId,
    reason: context.reason,
    ...(context.issues !== undefined ? { issues: context.issues } : {}),
  });
}
