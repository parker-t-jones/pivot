import type { PickProgress } from '@pivot/shared';
import { describe, expect, it } from 'vitest';
import { settledResult, slipSummary } from './slipSummary.js';

const legs = (...statuses: PickProgress['status'][]): PickProgress[] =>
  statuses.map((status) => ({ status }));

describe('slipSummary', () => {
  it('is pending before any leg starts', () => {
    expect(slipSummary(legs('pending', 'pending'))).toEqual({
      status: 'pending',
      legs: 2,
      hit: 0,
      alive: 2,
      lost: 0,
      refunded: 0,
    });
  });

  it('counts legs hit and alive while live', () => {
    expect(slipSummary(legs('hit', 'live', 'pending', 'won'))).toEqual({
      status: 'live',
      legs: 4,
      hit: 2,
      alive: 2,
      lost: 0,
      refunded: 0,
    });
  });

  it('is lost as soon as one leg loses or misses, even with others alive', () => {
    expect(slipSummary(legs('missed', 'live', 'pending')).status).toBe('lost');
    expect(slipSummary(legs('won', 'lost')).status).toBe('lost');
  });

  it('drops tie and void legs and is won when the rest won', () => {
    expect(slipSummary(legs('won', 'tie', 'void'))).toMatchObject({ status: 'won', refunded: 2 });
  });

  it('stays live while a won slip still has an open leg', () => {
    expect(slipSummary(legs('won', 'hit')).status).toBe('live');
  });

  it('is void when every leg is refunded', () => {
    expect(slipSummary(legs('void', 'tie')).status).toBe('void');
  });

  it('keeps the slip open on an unavailable leg instead of guessing', () => {
    expect(slipSummary(legs('won', 'unavailable')).status).toBe('live');
  });
});

describe('settledResult', () => {
  it('returns only final results', () => {
    expect(settledResult('won')).toBe('won');
    expect(settledResult('void')).toBe('void');
    expect(settledResult('hit')).toBeNull();
    expect(settledResult('live')).toBeNull();
    expect(settledResult('unavailable')).toBeNull();
  });
});
