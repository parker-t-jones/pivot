import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErrorReporter } from '@pivot/shared';
import { IngestionError, reportShapeFailure } from './errors.js';

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

    reportShapeFailure(reporter, {
      eventId: '401873308',
      reason: 'response did not match the expected shape',
      issues: [{ path: ['drives'], message: 'expected array' }],
    });

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

    reportShapeFailure(reporter, {
      eventId: '401873308',
      reason: 'summary header did not identify both competing teams',
    });

    const [call] = calls;
    if (!call) throw new Error('expected reportShapeFailure to have called the reporter');
    const [, context] = call;
    expect(context).toEqual({
      eventId: '401873308',
      reason: 'summary header did not identify both competing teams',
    });
    expect(context).not.toHaveProperty('issues');
  });
});
