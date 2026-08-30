import { describe, expect, it, vi } from 'vitest';
import { NoOpErrorReporter } from './errorReporter.js';
import { SentryErrorReporter, initSentry, type SentryClient } from './sentryErrorReporter.js';

function makeFakeSentry(): {
  client: SentryClient;
  initCalls: unknown[];
  captureCalls: unknown[][];
} {
  const initCalls: unknown[] = [];
  const captureCalls: unknown[][] = [];
  const client: SentryClient = {
    init: vi.fn((options) => {
      initCalls.push(options);
    }) as SentryClient['init'],
    captureException: vi.fn((...args: unknown[]) => {
      captureCalls.push(args);
      return 'fake-event-id';
    }) as SentryClient['captureException'],
  };
  return { client, initCalls, captureCalls };
}

describe('initSentry', () => {
  it('returns a NoOpErrorReporter and never touches the client when dsn is unset', () => {
    const { client, initCalls } = makeFakeSentry();

    const reporter = initSentry({
      dsn: undefined,
      environment: 'development',
      serviceName: 'ingestion',
      sentry: client,
    });

    expect(reporter).toBeInstanceOf(NoOpErrorReporter);
    expect(initCalls).toEqual([]);
  });

  it('initializes the injected client and returns a SentryErrorReporter when dsn is set', () => {
    const { client, initCalls } = makeFakeSentry();

    const reporter = initSentry({
      dsn: 'https://key@sentry.example/1',
      environment: 'production',
      serviceName: 'ingestion',
      sentry: client,
    });

    expect(reporter).toBeInstanceOf(SentryErrorReporter);
    expect(initCalls).toEqual([
      {
        dsn: 'https://key@sentry.example/1',
        environment: 'production',
        initialScope: { tags: { service: 'ingestion' } },
      },
    ]);
  });
});

describe('SentryErrorReporter', () => {
  it('forwards the error with context wrapped under extra', () => {
    const { client, captureCalls } = makeFakeSentry();
    const reporter = new SentryErrorReporter(client);
    const error = new Error('shape mismatch');

    reporter.captureException(error, { eventId: 'evt-1', reason: 'invalid_shape' });

    expect(captureCalls).toEqual([
      [error, { extra: { eventId: 'evt-1', reason: 'invalid_shape' } }],
    ]);
  });

  it('omits the extra key entirely when no context is passed', () => {
    const { client, captureCalls } = makeFakeSentry();
    const reporter = new SentryErrorReporter(client);
    const error = new Error('boom');

    reporter.captureException(error);

    expect(captureCalls).toEqual([[error, undefined]]);
  });
});
