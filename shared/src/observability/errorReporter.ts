/**
 * Cross-service error-reporting boundary (PLAN.md Section 5's Sentry row). Lives in `@pivot/shared`
 * rather than inside `@pivot/ingestion` specifically, since alerting on a failure is a concern every
 * service will eventually have, not one unique to ESPN ingestion — the first caller
 * (`reportShapeFailure` in `@pivot/ingestion`) just happens to be the first to need it.
 *
 * Deliberately generic rather than Sentry-specific in its name and shape: nothing outside this
 * folder should import `@sentry/node` directly (mirrors the `PlaySource` boundary — callers depend
 * on the interface, one implementation happens to wrap a specific vendor).
 */
export interface ErrorReporter {
  captureException(error: Error, context?: Record<string, unknown>): void;
}

/** Boots without a configured backend (no `SENTRY_DSN` — the local-dev default). Mirrors
 *  `NoOpPushNotifier`: silently absorbs calls rather than crashing an otherwise-working service
 *  because monitoring isn't wired up yet. */
export class NoOpErrorReporter implements ErrorReporter {
  captureException(_error: Error, _context?: Record<string, unknown>): void {
    // Intentionally does nothing — see class doc.
  }
}
