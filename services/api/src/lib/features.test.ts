import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FEATURE_BETS_INVALID,
  betsEnabledForUser,
  betsOnFor,
  loadFeatureBets,
  parseFeatureBets,
} from './features.js';

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

afterEach(() => {
  loadFeatureBets(undefined);
});

describe('FEATURE_BETS', () => {
  it('is false when unset', () => {
    loadFeatureBets(undefined);
    expect(betsEnabledForUser(ALICE)).toBe(false);
  });

  it('is false when off', () => {
    expect(betsOnFor(parseFeatureBets('off'), ALICE)).toBe(false);
    loadFeatureBets('off');
    expect(betsEnabledForUser(ALICE)).toBe(false);
  });

  it('is true for every user when all', () => {
    loadFeatureBets('all');
    expect(betsEnabledForUser(ALICE)).toBe(true);
    expect(betsEnabledForUser(BOB)).toBe(true);
  });

  it('is true on an allowlist hit', () => {
    loadFeatureBets(`${ALICE},${BOB}`);
    expect(betsEnabledForUser(ALICE)).toBe(true);
  });

  it('is false on an allowlist miss', () => {
    loadFeatureBets(ALICE);
    expect(betsEnabledForUser(BOB)).toBe(false);
  });

  it('logs and uses off when the value is invalid', () => {
    const log = vi.fn();
    loadFeatureBets('yes', log);
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(FEATURE_BETS_INVALID);
    expect(betsEnabledForUser(ALICE)).toBe(false);
  });
});
