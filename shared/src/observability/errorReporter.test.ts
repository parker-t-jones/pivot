import { describe, expect, it } from 'vitest';
import { NoOpErrorReporter } from './errorReporter.js';

describe('NoOpErrorReporter', () => {
  it('absorbs a call without throwing', () => {
    const reporter = new NoOpErrorReporter();

    expect(() => reporter.captureException(new Error('boom'))).not.toThrow();
    expect(() => reporter.captureException(new Error('boom'), { eventId: '1' })).not.toThrow();
  });
});
