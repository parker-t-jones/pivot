import { USER_SERVICES } from '@pivot/shared';
import { describe, expect, it } from 'vitest';
import {
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
      'amazon_prime',
      'peacock',
      'paramount_plus',
      'espn_plus',
      'nfl_plus',
    ]);
    expect([...USER_SERVICE_OPTIONS].sort()).toEqual([...USER_SERVICES].sort());
  });

  it('offers no networks and no antenna option', () => {
    for (const key of ['cbs', 'fox', 'nbc', 'abc', 'espn', 'nfl_network', 'hulu', 'antenna']) {
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
      'Prime Video',
      'Peacock',
      'Paramount+',
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
