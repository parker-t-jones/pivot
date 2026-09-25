import { z } from 'zod';
import {
  espnScoreboardSchema,
  espnSummarySchema,
  type EspnScoreboard,
  type EspnSummary,
} from './espnTypes.js';

const BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const SCOREBOARD_URL = `${BASE_URL}/scoreboard`;
const summaryUrl = (eventId: string): string => `${BASE_URL}/summary?event=${eventId}`;

/** Bounds one ESPN `fetch`. An abort is a `network_error`; the poll loop retries. */
const FETCH_TIMEOUT_MS = 8_000;

export type EspnFetchFailureKind = 'network_error' | 'http_error' | 'invalid_shape';

export interface EspnFetchFailure {
  ok: false;
  kind: EspnFetchFailureKind;
  reason: string;
  /** zod issues, present only when `kind` is `'invalid_shape'`. */
  issues?: unknown;
}

export type EspnFetchResult<T> = { ok: true; data: T } | EspnFetchFailure;

/**
 * Fetches and validates one ESPN endpoint. Never throws — every failure mode (the fetch itself
 * rejecting, a non-2xx response, or a response that doesn't match `schema`) becomes a typed
 * `EspnFetchFailure` instead, because all three are expected, recoverable conditions against an
 * undocumented API that the caller (`EspnPlaySource`) needs to distinguish: a shape mismatch is
 * worth reporting to `@pivot/shared`'s `ErrorReporter`, while a transient network/HTTP failure is
 * just worth logging and retrying next poll — mirroring how `experiments/espn-latency-probe.ts`'s
 * poll loop already treated a failed fetch as "log and keep going", never as fatal.
 *
 * This is a deliberate departure from `sleeperClient`'s throw-on-`!response.ok` style: Sleeper is a
 * stable, documented API consumed from request-handling code where throwing (→ a 502) is the right
 * behavior. ESPN is unofficial and polled continuously in the background, where a single bad poll
 * should never take down the loop.
 */
async function fetchAndValidate<T>(url: string, schema: z.ZodType<T>): Promise<EspnFetchResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (error) {
    const aborted = controller.signal.aborted;
    return {
      ok: false,
      kind: 'network_error',
      reason: aborted
        ? `ESPN request aborted after ${FETCH_TIMEOUT_MS}ms`
        : `ESPN request threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    return {
      ok: false,
      kind: 'http_error',
      reason: `ESPN request failed: ${response.status} ${response.statusText}`,
    };
  }

  const json: unknown = await response.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      kind: 'invalid_shape',
      reason: 'response did not match the expected shape',
      issues: parsed.error.issues,
    };
  }

  return { ok: true, data: parsed.data };
}

export interface EspnClient {
  getScoreboard(): Promise<EspnFetchResult<EspnScoreboard>>;
  getSummary(eventId: string): Promise<EspnFetchResult<EspnSummary>>;
}

/** Thin, typed wrapper over the two ESPN site-API endpoints ingestion needs — mirrors
 *  `sleeperClient`'s shape (a plain object of async methods) while diverging on error handling for
 *  the reasons in `fetchAndValidate`'s doc comment. */
export const espnClient: EspnClient = {
  async getScoreboard(): Promise<EspnFetchResult<EspnScoreboard>> {
    return fetchAndValidate(SCOREBOARD_URL, espnScoreboardSchema);
  },

  async getSummary(eventId: string): Promise<EspnFetchResult<EspnSummary>> {
    return fetchAndValidate(summaryUrl(eventId), espnSummarySchema);
  },
};
