import { USER_SERVICES } from '@pivot/shared/broadcast';
import { describe, expect, it } from 'vitest';
import {
  showsPayTvSignInCopy,
  showsSundayTicketHint,
  USER_SERVICE_OPTIONS,
  userServiceAppStoreUrl,
  userServiceLabel,
} from './streamingServices';

describe('USER_SERVICE_OPTIONS', () => {
  it('is exactly the §1.4 user-service list, in picker order', () => {
    expect(USER_SERVICE_OPTIONS).toEqual([
      'youtube_tv',
      'sunday_ticket',
      'hulu_live',
      'fubo',
      'directv',
      'sling',
      'cable_other',
      'amazon_prime',
      'peacock',
      'paramount_plus',
      'fox_one',
      'espn',
      'espn_plus',
      'nfl_plus',
    ]);
    expect([...USER_SERVICE_OPTIONS].sort()).toEqual([...USER_SERVICES].sort());
  });

  it('offers no OTA network keys and no antenna option', () => {
    for (const key of ['cbs', 'fox', 'nbc', 'abc', 'nfl_network', 'hulu', 'antenna']) {
      expect(USER_SERVICE_OPTIONS as readonly string[]).not.toContain(key);
    }
  });
});

describe('userServiceLabel', () => {
  it('uses the §1.4 labels', () => {
    expect(USER_SERVICE_OPTIONS.map(userServiceLabel)).toEqual([
      'YouTube TV',
      'NFL Sunday Ticket',
      'Hulu + Live TV',
      'Fubo',
      'DIRECTV',
      'Sling TV',
      'Other cable',
      'Prime Video',
      'Peacock',
      'Paramount+',
      'FOX One',
      'ESPN',
      'ESPN+',
      'NFL+',
    ]);
  });

  it('falls back to the raw value outside the catalog', () => {
    expect(userServiceLabel('fox')).toBe('fox');
  });
});

describe('userServiceAppStoreUrl', () => {
  it('returns an App Store search link for a user service and null otherwise', () => {
    expect(userServiceAppStoreUrl('youtube_tv')).toBe(
      'https://apps.apple.com/us/search?term=YouTube%20TV',
    );
    expect(userServiceAppStoreUrl('fox')).toBeNull();
    expect(userServiceAppStoreUrl('cable_other')).toBeNull();
  });
});

describe('showsPayTvSignInCopy', () => {
  it('is the pay-TV picks, and only other cable of FOX One, other cable, and the ESPN app', () => {
    expect(showsPayTvSignInCopy('youtube_tv')).toBe(false);
    expect(showsPayTvSignInCopy('hulu_live')).toBe(true);
    expect(showsPayTvSignInCopy('fubo')).toBe(true);
    expect(showsPayTvSignInCopy('directv')).toBe(true);
    expect(showsPayTvSignInCopy('cable_other')).toBe(true);
    expect(showsPayTvSignInCopy('fox_one')).toBe(false);
    expect(showsPayTvSignInCopy('espn')).toBe(false);
    expect(showsPayTvSignInCopy('espn_plus')).toBe(false);
    expect(showsPayTvSignInCopy('sling')).toBe(false);
  });
});

describe('showsSundayTicketHint', () => {
  it('shows only when YouTube TV is on and Sunday Ticket is not', () => {
    expect(showsSundayTicketHint(new Map([['youtube_tv', true]]))).toBe(true);
    expect(
      showsSundayTicketHint(
        new Map([
          ['youtube_tv', true],
          ['sunday_ticket', false],
        ]),
      ),
    ).toBe(true);
    expect(
      showsSundayTicketHint(
        new Map([
          ['youtube_tv', true],
          ['sunday_ticket', true],
        ]),
      ),
    ).toBe(false);
    expect(showsSundayTicketHint(new Map([['youtube_tv', false]]))).toBe(false);
    expect(showsSundayTicketHint(new Map())).toBe(false);
  });
});
