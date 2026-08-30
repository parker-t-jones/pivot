import * as realSentry from '@sentry/node';
import { NoOpErrorReporter, type ErrorReporter } from './errorReporter.js';

/**
 * The subset of the `@sentry/node` module surface this file calls, narrowed the same way
 * `ExpoPushNotifier` narrows the Expo SDK to `ExpoClient` — so tests can inject a fake without
 * touching Sentry's real (module-global) client state.
 */
export type SentryClient = Pick<typeof realSentry, 'init' | 'captureException'>;

/** Reports through a configured Sentry client. Construct via `initSentry`, not directly — that's
 *  what actually calls `sentry.init`; this class only wraps the already-initialized client. */
export class SentryErrorReporter implements ErrorReporter {
  constructor(private readonly sentry: SentryClient) {}

  captureException(error: Error, context?: Record<string, unknown>): void {
    this.sentry.captureException(error, context ? { extra: context } : undefined);
  }
}

export interface InitSentryOptions {
  /** From `SENTRY_DSN`. Absent (unset in dev) is expected, not an error — see below. */
  dsn: string | undefined;
  environment: string;
  /** Tagged on every event so a shared Sentry project can be filtered by which service raised it. */
  serviceName: string;
  /** Injectable for tests; defaults to the real `@sentry/node` module. */
  sentry?: SentryClient;
}

/**
 * Wires up Sentry, or doesn't. Confirmed against the real SDK (10.72.0) before writing this: calling
 * `init` with no `dsn`, then `captureException`, throws nothing and sends nothing — the SDK no-ops
 * internally. This still returns a `NoOpErrorReporter` explicitly rather than relying on that,
 * because a caller reading this file shouldn't have to know Sentry's undocumented-here internal
 * behavior to understand why nothing gets reported in dev.
 *
 * This is the first real Sentry integration in the codebase (PLAN.md Section 5's Sentry row was
 * previously aspirational) — scoped for now to whichever service's entry point calls it, not wired
 * project-wide.
 */
export function initSentry(options: InitSentryOptions): ErrorReporter {
  if (options.dsn === undefined) {
    return new NoOpErrorReporter();
  }

  const sentry = options.sentry ?? realSentry;
  sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    initialScope: { tags: { service: options.serviceName } },
  });
  return new SentryErrorReporter(sentry);
}
