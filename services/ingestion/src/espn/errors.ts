import { defaultClock, type Clock } from '@pivot/engine';
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
  /**
   * Identifies the distinct *kind* of failure — e.g. `'shape-mismatch:getSummary'` or
   * `'missing-team-context'` — for `ShapeFailureReportThrottle` to key on. Deliberately separate
   * from `reason`: two different call sites can produce identical `reason` text (`espnClient`'s
   * `fetchAndValidate` returns the same generic message for both `getScoreboard` and `getSummary`),
   * so throttling on `reason` would wrongly collapse them into one bucket. Callers own choosing a
   * signature granular enough that two genuinely different problems never share one.
   */
  signature: string;
  /** What went wrong, in human terms — e.g. "response did not match the expected shape". */
  reason: string;
  /** The zod issues describing the mismatch, when there are any (absent for e.g. a header that
   *  parsed fine but didn't identify both teams). Kept as `unknown` so this file doesn't depend on
   *  zod's error-issue shape. */
  issues?: unknown;
}

/**
 * Default throttle window for `ShapeFailureReportThrottle`. Not derived from an existing constant —
 * `rateLimiter.ts`'s `WINDOW_MS` (user-facing notification rate limiting) and
 * `resumptionWatcher.ts`'s `RESUMPTION_CEILING_MS` (how long to wait for a play) throttle unrelated
 * things — 5 minutes is a fresh, reasonable default for bounding Sentry event volume during a
 * sustained outage without needing a more precise number.
 */
export const SHAPE_FAILURE_REPORT_WINDOW_MS = 5 * 60 * 1000;

export interface ShapeFailureReportThrottleOptions {
  windowMs?: number;
  /** Injectable for tests; defaults to the real wall clock. */
  clock?: Clock;
}

/**
 * Per-process, in-memory throttle for `reportShapeFailure`'s Sentry side (console logging is never
 * throttled — see that function). Exists because `EspnPlaySource` polls every 5s: a sustained shape
 * failure — the exact scenario Sentry reporting is here to catch — could otherwise generate ~720
 * reportable events/hour, enough to exhaust a free-tier monthly quota in well under a day.
 *
 * Limitation, accepted rather than solved: this is a plain in-memory `Map`, so it doesn't persist
 * across a process restart or span multiple processes. A restart simply re-arms every signature's
 * first-occurrence report, which is fine here — the goal is bounding volume during one continuous
 * failure episode, not an exactly-once delivery guarantee.
 */
export class ShapeFailureReportThrottle {
  private readonly windowMs: number;
  private readonly clock: Clock;
  private readonly lastReportedAtMs = new Map<string, number>();

  constructor(options: ShapeFailureReportThrottleOptions = {}) {
    this.windowMs = options.windowMs ?? SHAPE_FAILURE_REPORT_WINDOW_MS;
    this.clock = options.clock ?? defaultClock;
  }

  /**
   * `true` the first time `signature` is seen, or again once `windowMs` has elapsed since the last
   * time it returned `true` for that signature; `false` (suppressed) otherwise. The window slides
   * from the last *reported* occurrence rather than the first sighting, since recording only
   * happens on a `true` return.
   */
  shouldReport(signature: string): boolean {
    const now = this.clock();
    const last = this.lastReportedAtMs.get(signature);
    if (last !== undefined && now - last < this.windowMs) return false;
    this.lastReportedAtMs.set(signature, now);
    return true;
  }
}

/**
 * A malformed or incomplete ESPN response is an expected condition against an undocumented,
 * unofficial API (PLAN.md Section 5) — not a bug — so this logs and lets the caller skip the
 * affected play/cycle rather than throwing and crashing the poll loop.
 *
 * `console.error` (local dev visibility) runs on EVERY call, unthrottled. The injected
 * `ErrorReporter` (production alerting) runs through `throttle` first — at most once per
 * `context.signature` per throttle window — so a sustained failure logs continuously but reports to
 * Sentry only occasionally. Local logging should never be suppressed; only the network call is.
 */
export function reportShapeFailure(
  reporter: ErrorReporter,
  context: ShapeFailureContext,
  throttle: ShapeFailureReportThrottle,
): void {
  console.error('[espn-ingestion] shape validation failed', context);

  if (!throttle.shouldReport(context.signature)) return;

  const error = new IngestionError(
    `ESPN response shape mismatch (event ${context.eventId}): ${context.reason}`,
  );
  reporter.captureException(error, {
    eventId: context.eventId,
    reason: context.reason,
    ...(context.issues !== undefined ? { issues: context.issues } : {}),
  });
}
