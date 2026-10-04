import { describe, expect, it } from 'vitest';
import { isThursdayEt, matchupSearchQuery, serviceWatchUrl } from './watchLinks.js';

const THURSDAY_ET = new Date('2026-10-02T00:15:00Z');
const SUNDAY_ET = new Date('2026-09-27T17:00:00Z');

describe('serviceWatchUrl', () => {
  it('encodes a YouTube TV search for the nicknames plus today', () => {
    const url = serviceWatchUrl({
      service: 'youtube_tv',
      awayNickname: 'Lions',
      homeNickname: 'Panthers',
      kickoff: SUNDAY_ET,
      network: 'fox',
    });
    expect(url).toBe('https://tv.youtube.com/search/Lions%20vs%20Panthers%20today');
    expect(url).not.toContain('/nflst/');
  });

  it('uses the same today phrase for an NFL Network game', () => {
    expect(
      serviceWatchUrl({
        service: 'youtube_tv',
        awayNickname: 'Colts',
        homeNickname: 'Commanders',
        kickoff: SUNDAY_ET,
        network: 'nfl_network',
      }),
    ).toBe('https://tv.youtube.com/search/Colts%20vs%20Commanders%20today');
  });

  it('uses the same search for Sunday Ticket', () => {
    expect(
      serviceWatchUrl({
        service: 'sunday_ticket',
        awayNickname: 'Lions',
        homeNickname: 'Panthers',
        kickoff: SUNDAY_ET,
        network: 'fox',
      }),
    ).toBe('https://tv.youtube.com/search/Lions%20vs%20Panthers%20today');
  });

  it('encodes spaces and punctuation in nicknames', () => {
    const query = matchupSearchQuery('49ers', 'St. Louis');
    expect(query).toBe('49ers vs St. Louis today');
    expect(
      serviceWatchUrl({
        service: 'youtube_tv',
        awayNickname: '49ers',
        homeNickname: 'St. Louis',
        kickoff: SUNDAY_ET,
        network: 'fox',
      }),
    ).toBe(`https://tv.youtube.com/search/${encodeURIComponent(query)}`);
    expect(
      serviceWatchUrl({
        service: 'amazon_prime',
        awayNickname: '49ers',
        homeNickname: 'St. Louis',
        kickoff: SUNDAY_ET,
        network: 'amazon_prime',
      }),
    ).toBe(
      `https://app.primevideo.com/search?phrase=${encodeURIComponent(matchupSearchQuery('49ers', 'St. Louis'))}`,
    );
  });

  it('searches Thursday Night Football for a Thursday Prime game', () => {
    expect(isThursdayEt(THURSDAY_ET)).toBe(true);
    expect(
      serviceWatchUrl({
        service: 'amazon_prime',
        awayNickname: 'Steelers',
        homeNickname: 'Browns',
        kickoff: THURSDAY_ET,
        network: 'amazon_prime',
      }),
    ).toBe('https://app.primevideo.com/search?phrase=Thursday%20Night%20Football');
  });

  it('searches the matchup for a non-Thursday Prime game', () => {
    expect(isThursdayEt(SUNDAY_ET)).toBe(false);
    expect(
      serviceWatchUrl({
        service: 'amazon_prime',
        awayNickname: 'Lions',
        homeNickname: 'Panthers',
        kickoff: SUNDAY_ET,
        network: 'amazon_prime',
      }),
    ).toBe('https://app.primevideo.com/search?phrase=Lions%20vs%20Panthers%20today');
  });

  it('keeps the device-tested static landings', () => {
    const base = {
      awayNickname: 'Lions',
      homeNickname: 'Panthers',
      kickoff: SUNDAY_ET,
      network: 'fox' as const,
    };
    expect(serviceWatchUrl({ ...base, service: 'nfl_plus' })).toBe('https://www.nfl.com/scores');
    expect(serviceWatchUrl({ ...base, service: 'espn_plus' })).toBe(
      'https://www.espn.com/nfl/team',
    );
    expect(serviceWatchUrl({ ...base, service: 'paramount_plus' })).toBe(
      'https://www.paramountplus.com/live-tv/',
    );
    expect(serviceWatchUrl({ ...base, service: 'peacock' })).toBe(
      'https://www.peacocktv.com/watch/sports',
    );
  });
});
