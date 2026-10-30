import { describe, expect, it } from 'vitest';
import {
  browserPrimeWatchUrl,
  isThursdayEt,
  matchupSearchQuery,
  PRIME_VIDEO_IOS_DETAIL_URL,
  PRIME_VIDEO_WEB_STOREFRONT,
  serviceWatchUrl,
} from './watchLinks.js';

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

  it('searches DirecTV for the matchup without a today suffix', () => {
    expect(
      serviceWatchUrl({
        service: 'directv',
        awayNickname: 'Bills',
        homeNickname: 'Patriots',
        kickoff: SUNDAY_ET,
        network: 'cbs',
      }),
    ).toBe('https://stream.directv.com/search?q=Bills%20vs%20Patriots');
  });

  it('uses the DirecTV homepage when the matchup names are missing', () => {
    expect(
      serviceWatchUrl({
        service: 'directv',
        awayNickname: '',
        homeNickname: 'Patriots',
        kickoff: SUNDAY_ET,
        network: 'cbs',
      }),
    ).toBe('https://www.directv.com/');
  });

  it('searches NFL ST today for Sunday Ticket', () => {
    expect(
      serviceWatchUrl({
        service: 'sunday_ticket',
        awayNickname: 'Lions',
        homeNickname: 'Panthers',
        kickoff: SUNDAY_ET,
        network: 'fox',
      }),
    ).toBe('https://tv.youtube.com/search/Lions%20vs%20Panthers%20NFL%20ST%20today');
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
    ).toBe(PRIME_VIDEO_IOS_DETAIL_URL);
  });

  it('opens the Prime detail page for a Thursday Prime game', () => {
    expect(isThursdayEt(THURSDAY_ET)).toBe(true);
    expect(PRIME_VIDEO_IOS_DETAIL_URL).toBe('https://app.primevideo.com/detail?gti=%7BGTI%7D');
    expect(
      serviceWatchUrl({
        service: 'amazon_prime',
        awayNickname: 'Steelers',
        homeNickname: 'Browns',
        kickoff: THURSDAY_ET,
        network: 'amazon_prime',
      }),
    ).toBe(PRIME_VIDEO_IOS_DETAIL_URL);
  });

  it('sends a browser to the Prime storefront instead of the app link or splash', () => {
    expect(PRIME_VIDEO_WEB_STOREFRONT).toBe('https://www.primevideo.com/storefront');
    expect(browserPrimeWatchUrl(PRIME_VIDEO_IOS_DETAIL_URL)).toBe(PRIME_VIDEO_WEB_STOREFRONT);
    expect(
      browserPrimeWatchUrl('https://www.primevideo.com/splash/t/getTheApp?ref_=atv_dl_rdr'),
    ).toBe(PRIME_VIDEO_WEB_STOREFRONT);
    expect(browserPrimeWatchUrl('https://tv.youtube.com/search/Lions%20vs%20Panthers%20today')).toBe(
      'https://tv.youtube.com/search/Lions%20vs%20Panthers%20today',
    );
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
    ).toBe(PRIME_VIDEO_IOS_DETAIL_URL);
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
