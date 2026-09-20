import { describe, expect, it } from 'vitest';
import { parsePreferences } from '@pivot/shared';
import { resolveWatchedLeagueIds } from './watched-leagues.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const GONE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

describe('resolveWatchedLeagueIds', () => {
  it('auto-fills the oldest owned league when watch list is empty', () => {
    expect(
      resolveWatchedLeagueIds({
        preferences: parsePreferences({}),
        subscriptionTier: 'free',
        ownedLeagueIds: [A, B, C],
      }),
    ).toEqual([A]);
  });

  it('clamps free tier to one watched league', () => {
    expect(
      resolveWatchedLeagueIds({
        preferences: parsePreferences({
          watchedLeagueIds: [B, C],
        }),
        subscriptionTier: 'free',
        ownedLeagueIds: [A, B, C],
      }),
    ).toEqual([B]);
  });

  it('allows multiple watched leagues on pro', () => {
    expect(
      resolveWatchedLeagueIds({
        preferences: parsePreferences({
          watchedLeagueIds: [A, C],
        }),
        subscriptionTier: 'pro',
        ownedLeagueIds: [A, B, C],
      }),
    ).toEqual([A, C]);
  });

  it('drops ids the user no longer owns', () => {
    expect(
      resolveWatchedLeagueIds({
        preferences: parsePreferences({
          watchedLeagueIds: [GONE, B],
        }),
        subscriptionTier: 'pro',
        ownedLeagueIds: [A, B],
      }),
    ).toEqual([B]);
  });
});
