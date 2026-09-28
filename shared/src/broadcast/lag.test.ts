import { describe, expect, it } from 'vitest';
import { DEFAULT_LAG_SECONDS, lagSecondsFor, USER_SERVICE_LAG_SECONDS } from './lag.js';
import { USER_SERVICES } from './types.js';

describe('USER_SERVICE_LAG_SECONDS', () => {
  it('has an entry for every user service', () => {
    expect(Object.keys(USER_SERVICE_LAG_SECONDS).sort()).toEqual([...USER_SERVICES].sort());
  });

  it('uses the measured YouTube TV value for YouTube TV and Sunday Ticket, 75 for unmeasured vMVPDs', () => {
    expect(USER_SERVICE_LAG_SECONDS).toEqual({
      sunday_ticket: 30,
      youtube_tv: 30,
      hulu_live: 75,
      fubo: 75,
      directv: 75,
      sling: 75,
      amazon_prime: 40,
      peacock: 45,
      paramount_plus: 50,
      espn_plus: 60,
      nfl_plus: 60,
    });
  });
});

describe('lagSecondsFor', () => {
  it('looks up a user service', () => {
    expect(lagSecondsFor('sunday_ticket')).toBe(30);
    expect(lagSecondsFor('amazon_prime')).toBe(40);
  });

  it('falls back to 60 for a key outside the table, including airing networks', () => {
    expect(DEFAULT_LAG_SECONDS).toBe(60);
    expect(lagSecondsFor('some_future_service')).toBe(60);
    expect(lagSecondsFor('fox')).toBe(60);
  });

  it('falls back to 60 for a null (unresolved) source', () => {
    expect(lagSecondsFor(null)).toBe(60);
  });
});
