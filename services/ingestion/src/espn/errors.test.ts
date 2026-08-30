import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErrorReporter } from '@pivot/shared';
import { IngestionError, reportShapeFailure, ShapeFailureReportThrottle } from './errors.js';

function makeCapturingReporter(): { reporter: ErrorReporter; calls: [Error, unknown][] } {
  const calls: [Error, unknown][] = [];
  return {
    reporter: {
      captureException(error, context) {
        calls.push([error, context]);
      },
    },
    calls,
  };
}

/** A throttle with a controllable, non-real clock — no real waiting needed to test window edges. */
function makeControllableThrottle(windowMs = 5 * 60 * 1000): {
  throttle: ShapeFailureReportThrottle;
  advance: (ms: number) => void;
} {
  let now = 0;
  return {
    throttle: new ShapeFailureReportThrottle({ windowMs, clock: () => now }),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('reportShapeFailure', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('logs to console.error AND captures via the injected reporter — both, not either', () => {
    const { reporter, calls } = makeCapturingReporter();
    const { throttle } = makeControllableThrottle();

    reportShapeFailure(
      reporter,
      {
        eventId: '401873308',
        signature: 'shape-mismatch:getSummary',
        reason: 'response did not match the expected shape',
        issues: [{ path: ['drives'], message: 'expected array' }],
      },
      throttle,
    );

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[espn-ingestion] shape validation failed',
      expect.objectContaining({ eventId: '401873308' }),
    );

    expect(calls).toHaveLength(1);
    const [call] = calls;
    if (!call) throw new Error('expected reportShapeFailure to have called the reporter');
    const [error, context] = call;
    expect(error).toBeInstanceOf(IngestionError);
    expect(error.message).toBe(
      'ESPN response shape mismatch (event 401873308): response did not match the expected shape',
    );
    expect(context).toEqual({
      eventId: '401873308',
      reason: 'response did not match the expected shape',
      issues: [{ path: ['drives'], message: 'expected array' }],
    });
  });

  it('omits the issues key from the reported context when none were given', () => {
    const { reporter, calls } = makeCapturingReporter();
    const { throttle } = makeControllableThrottle();

    reportShapeFailure(
      reporter,
      {
        eventId: '401873308',
        signature: 'missing-team-context',
        reason: 'summary header did not identify both competing teams',
      },
      throttle,
    );

    const [call] = calls;
    if (!call) throw new Error('expected reportShapeFailure to have called the reporter');
    const [, context] = call;
    expect(context).toEqual({
      eventId: '401873308',
      reason: 'summary header did not identify both competing teams',
    });
    expect(context).not.toHaveProperty('issues');
  });

  it('reports to Sentry once for a repeated identical failure signature within the window, but logs to console every time', () => {
    const { reporter, calls } = makeCapturingReporter();
    const { throttle } = makeControllableThrottle(5 * 60 * 1000);
    const context = {
      eventId: '401873308',
      signature: 'shape-mismatch:getSummary',
      reason: 'response did not match the expected shape',
    };

    reportShapeFailure(reporter, context, throttle);
    reportShapeFailure(reporter, context, throttle);
    reportShapeFailure(reporter, context, throttle);

    expect(calls).toHaveLength(1);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(3);
  });

  it('reports again once the throttle window has fully elapsed', () => {
    const { reporter, calls } = makeCapturingReporter();
    const { throttle, advance } = makeControllableThrottle(5 * 60 * 1000);
    const context = {
      eventId: '401873308',
      signature: 'shape-mismatch:getSummary',
      reason: 'response did not match the expected shape',
    };

    reportShapeFailure(reporter, context, throttle);
    advance(5 * 60 * 1000);
    reportShapeFailure(reporter, context, throttle);

    expect(calls).toHaveLength(2);
  });

  it('reports two distinct failure signatures independently — neither suppresses the other', () => {
    const { reporter, calls } = makeCapturingReporter();
    const { throttle } = makeControllableThrottle(5 * 60 * 1000);

    reportShapeFailure(
      reporter,
      { eventId: '401873308', signature: 'shape-mismatch:getSummary', reason: 'a' },
      throttle,
    );
    reportShapeFailure(
      reporter,
      { eventId: '401873308', signature: 'missing-team-context', reason: 'b' },
      throttle,
    );
    // Repeats of each within the window are still individually suppressed.
    reportShapeFailure(
      reporter,
      { eventId: '401873308', signature: 'shape-mismatch:getSummary', reason: 'a' },
      throttle,
    );
    reportShapeFailure(
      reporter,
      { eventId: '401873308', signature: 'missing-team-context', reason: 'b' },
      throttle,
    );

    expect(calls).toHaveLength(2);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(4);
  });
});

describe('ShapeFailureReportThrottle', () => {
  it('allows the first occurrence of any signature through', () => {
    const { throttle } = makeControllableThrottle();
    expect(throttle.shouldReport('shape-mismatch:getSummary')).toBe(true);
  });

  it('suppresses a repeat of the same signature within the window', () => {
    const { throttle, advance } = makeControllableThrottle(5000);

    expect(throttle.shouldReport('sig')).toBe(true);
    advance(4999);
    expect(throttle.shouldReport('sig')).toBe(false);
  });

  it('allows a repeat once the window has fully elapsed, sliding from the last report', () => {
    const { throttle, advance } = makeControllableThrottle(5000);

    expect(throttle.shouldReport('sig')).toBe(true);
    advance(5000);
    expect(throttle.shouldReport('sig')).toBe(true);
    // Window resets from THIS report, not the original — a repeat 4999ms later is suppressed again.
    advance(4999);
    expect(throttle.shouldReport('sig')).toBe(false);
  });

  it('tracks distinct signatures in independent buckets', () => {
    const { throttle } = makeControllableThrottle(5000);

    expect(throttle.shouldReport('sig-a')).toBe(true);
    expect(throttle.shouldReport('sig-b')).toBe(true);
    expect(throttle.shouldReport('sig-a')).toBe(false);
    expect(throttle.shouldReport('sig-b')).toBe(false);
  });

  it('defaults to the 5-minute window when unconfigured', () => {
    let now = 0;
    const throttle = new ShapeFailureReportThrottle({ clock: () => now });

    expect(throttle.shouldReport('sig')).toBe(true);
    now += 5 * 60 * 1000 - 1;
    expect(throttle.shouldReport('sig')).toBe(false);
    now += 1;
    expect(throttle.shouldReport('sig')).toBe(true);
  });
});
