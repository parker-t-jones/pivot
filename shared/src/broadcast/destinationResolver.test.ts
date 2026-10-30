import { describe, expect, it } from 'vitest';

import { mapMediaName } from './mapMediaName.js';
import {
  resolveDestinations,
  resolveStoredDestination,
  type DestinationGame,
  type ResolverService,
} from './destinationResolver.js';
import { serviceWatchUrl } from './watchLinks.js';

const KICKOFF = new Date('2026-10-04T17:00:00Z');

const YTTV = 'https://tv.youtube.com/search/Bears%20vs%20Falcons%20today';
const SUNDAY_TICKET = 'https://tv.youtube.com/search/Bears%20vs%20Falcons%20NFL%20ST%20today';
const FOX_SEARCH = 'https://www.fox.com/search?q=Bears%20at%20Falcons';
const FOX_CHANNELS = 'https://www.fox.com/live/channels';
const CBS = 'https://www.cbs.com/live-tv/stream/';
const NBC = 'https://www.nbc.com/live?brand=nbc';
const ABC = 'https://abc.com/watch-live/b2f23a6e-a2a4-4d63-bd3b-e330921b0942';
const PARAMOUNT = 'https://www.paramountplus.com/live-tv/';
const PEACOCK = 'https://www.peacocktv.com/watch/sports';
const ESPN = 'https://www.espn.com/watch/';
const PRIME = 'https://app.primevideo.com/detail?gti=%7BGTI%7D';

function game(rawNames: readonly string[], patch?: Partial<DestinationGame>): DestinationGame {
  return {
    awayNickname: 'Bears',
    homeNickname: 'Falcons',
    kickoff: KICKOFF,
    airings: rawNames.map((rawName) => ({ rawName })),
    savedUrl: null,
    outOfMarketSunday: false,
    ...patch,
  };
}

interface MatrixCell {
  network: string;
  services: readonly ResolverService[];
  primary: string | 'unavailable';
  label: string;
}

const MATRIX: readonly MatrixCell[] = [
  { network: 'CBS', services: ['youtube_tv'], primary: YTTV, label: 'YouTube TV search' },
  { network: 'CBS', services: ['directv'], primary: CBS, label: 'cbs.com live' },
  { network: 'CBS', services: ['paramount_plus'], primary: PARAMOUNT, label: 'Paramount+ live' },
  { network: 'CBS', services: ['peacock'], primary: 'unavailable', label: 'unavailable' },
  { network: 'CBS', services: ['amazon_prime'], primary: 'unavailable', label: 'unavailable' },
  { network: 'FOX', services: ['youtube_tv'], primary: YTTV, label: 'YouTube TV search' },
  { network: 'FOX', services: ['directv'], primary: FOX_SEARCH, label: 'FOX search' },
  { network: 'FOX', services: ['paramount_plus'], primary: 'unavailable', label: 'unavailable' },
  { network: 'FOX', services: ['peacock'], primary: 'unavailable', label: 'unavailable' },
  { network: 'FOX', services: ['amazon_prime'], primary: 'unavailable', label: 'unavailable' },
  { network: 'NBC', services: ['youtube_tv'], primary: YTTV, label: 'YouTube TV search' },
  { network: 'NBC', services: ['directv'], primary: NBC, label: 'nbc.com live' },
  { network: 'NBC', services: ['paramount_plus'], primary: 'unavailable', label: 'unavailable' },
  { network: 'NBC', services: ['peacock'], primary: PEACOCK, label: 'Peacock sports' },
  { network: 'NBC', services: ['amazon_prime'], primary: 'unavailable', label: 'unavailable' },
  { network: 'ABC', services: ['youtube_tv'], primary: YTTV, label: 'YouTube TV search' },
  { network: 'ABC', services: ['directv'], primary: ABC, label: 'ABC live' },
  { network: 'ABC', services: ['paramount_plus'], primary: 'unavailable', label: 'unavailable' },
  { network: 'ABC', services: ['peacock'], primary: 'unavailable', label: 'unavailable' },
  { network: 'ABC', services: ['amazon_prime'], primary: 'unavailable', label: 'unavailable' },
  {
    network: 'Prime Video',
    services: ['youtube_tv'],
    primary: 'unavailable',
    label: 'unavailable',
  },
  { network: 'Prime Video', services: ['directv'], primary: 'unavailable', label: 'unavailable' },
  {
    network: 'Prime Video',
    services: ['paramount_plus'],
    primary: 'unavailable',
    label: 'unavailable',
  },
  { network: 'Prime Video', services: ['peacock'], primary: 'unavailable', label: 'unavailable' },
  {
    network: 'Prime Video',
    services: ['amazon_prime'],
    primary: PRIME,
    label: 'current Prime link',
  },
];

describe('resolveDestinations matrix', () => {
  for (const cell of MATRIX) {
    const who = cell.services.join(' + ');
    it(`${cell.network} / ${who} → ${cell.label}`, () => {
      const result = resolveDestinations(game([cell.network]), cell.services);
      if (cell.primary === 'unavailable') {
        expect(result).toEqual({ kind: 'unavailable', reason: 'not_on_your_services' });
        return;
      }
      expect(result.kind).toBe('destinations');
      if (result.kind !== 'destinations') return;
      expect(result.primary.url).toBe(cell.primary);
    });
  }

  it('marks the Peacock landing unverified and the CBS live link verified', () => {
    const peacock = resolveDestinations(game(['NBC']), ['peacock']);
    const cbs = resolveDestinations(game(['CBS']), ['directv']);
    expect(peacock.kind).toBe('destinations');
    expect(cbs.kind).toBe('destinations');
    if (peacock.kind !== 'destinations' || cbs.kind !== 'destinations') return;
    expect(peacock.primary).toMatchObject({ url: PEACOCK, verified: false });
    expect(cbs.primary).toMatchObject({ url: CBS, verified: true });
  });

  it('leaves Prime on the current serviceWatchUrl', () => {
    const current = serviceWatchUrl({
      service: 'amazon_prime',
      awayNickname: 'Bears',
      homeNickname: 'Falcons',
      kickoff: KICKOFF,
      network: 'amazon_prime',
    });
    expect(current).toBe(PRIME);
    const result = resolveDestinations(game(['Prime Video']), ['amazon_prime']);
    expect(result.kind).toBe('destinations');
    if (result.kind !== 'destinations') return;
    expect(result.primary.url).toBe(current);
  });
});

describe('resolveDestinations ranking', () => {
  it('puts a saved link ahead of a verified network link', () => {
    const result = resolveDestinations(game(['CBS'], { savedUrl: 'https://example.com/cbs' }), [
      'directv',
    ]);
    expect(result).toMatchObject({
      kind: 'destinations',
      primary: { url: 'https://example.com/cbs' },
      alternates: [{ url: CBS }],
    });
  });

  it('treats a blank saved link as no row', () => {
    expect(resolveDestinations(game(['CBS'], { savedUrl: '   ' }), [])).toEqual({ kind: 'legacy' });
  });

  it('keeps Sunday Ticket primary for YouTube TV + Sunday Ticket on an out-of-market Sunday game', () => {
    const result = resolveDestinations(game(['FOX'], { outOfMarketSunday: true }), [
      'youtube_tv',
      'sunday_ticket',
    ]);
    expect(result).toMatchObject({
      kind: 'destinations',
      primary: { url: SUNDAY_TICKET, verified: true },
      alternates: [{ url: YTTV }],
    });
  });

  it('uses the YouTube TV search when the same user is not on an out-of-market Sunday slate', () => {
    const result = resolveDestinations(game(['FOX'], { outOfMarketSunday: false }), [
      'youtube_tv',
      'sunday_ticket',
    ]);
    expect(result).toMatchObject({
      kind: 'destinations',
      primary: { url: YTTV },
      alternates: [],
    });
  });

  it('ranks verified CBS ahead of unverified Paramount+ for DirecTV + Paramount+', () => {
    const result = resolveDestinations(game(['CBS']), ['paramount_plus', 'directv']);
    expect(result).toMatchObject({
      kind: 'destinations',
      primary: { url: CBS, verified: true },
      alternates: [{ url: PARAMOUNT, verified: false }],
    });
  });

  it('ranks the verified NBC link ahead of unverified Peacock', () => {
    const result = resolveDestinations(game(['NBC']), ['peacock', 'directv']);
    expect(result).toMatchObject({
      kind: 'destinations',
      primary: { url: NBC, verified: true },
      alternates: [{ url: PEACOCK, verified: false }],
    });
  });

  it('gives a DirecTV + ESPN user the ABC link on an ABC game', () => {
    const result = resolveDestinations(game(['ABC']), ['directv', 'espn']);
    expect(result).toMatchObject({
      kind: 'destinations',
      primary: { url: ABC, verified: true },
      alternates: [],
    });
  });

  it('does not send an ESPN-app user to espn.com/watch for an ABC-only game', () => {
    expect(resolveDestinations(game(['ABC']), ['espn'])).toEqual({
      kind: 'unavailable',
      reason: 'not_on_your_services',
    });
  });

  it('walks an ABC/ESPN simulcast and ranks the verified ABC link first', () => {
    const result = resolveDestinations(game(['ESPN', 'ABC']), ['directv', 'espn']);
    expect(result).toMatchObject({
      kind: 'destinations',
      primary: { url: ABC, verified: true },
      alternates: [{ url: ESPN, verified: false }],
    });
  });

  it('offers the FOX channel guide after the search link', () => {
    const directv = resolveDestinations(game(['Fox']), ['directv']);
    const foxOne = resolveDestinations(game(['FOX']), ['fox_one']);
    expect(directv).toMatchObject({
      kind: 'destinations',
      primary: { url: FOX_SEARCH, verified: true },
      alternates: [{ url: FOX_CHANNELS, verified: true }],
    });
    expect(foxOne).toMatchObject({
      kind: 'destinations',
      primary: { url: FOX_SEARCH },
      alternates: [{ url: FOX_CHANNELS }],
    });
  });

  it('uses the FOX channel guide when nicknames are missing', () => {
    const result = resolveDestinations(game(['FOX'], { awayNickname: '', homeNickname: '' }), [
      'cable_other',
    ]);
    expect(result).toMatchObject({
      kind: 'destinations',
      primary: { url: FOX_CHANNELS },
      alternates: [],
    });
  });

  it('sends cable_other to the CBS live link', () => {
    const result = resolveDestinations(game(['CBS']), ['cable_other']);
    expect(result).toMatchObject({
      kind: 'destinations',
      primary: { url: CBS, verified: true },
    });
  });
});

describe('resolveDestinations legacy and unknown', () => {
  it('searches YouTube TV when the game has no airings', () => {
    expect(resolveDestinations(game([]), ['youtube_tv'])).toMatchObject({
      kind: 'destinations',
      primary: { url: YTTV, note: 'YouTube TV search' },
      alternates: [],
    });
  });

  it('reports no broadcast info when DirecTV has no airings to match', () => {
    expect(resolveDestinations(game([]), ['directv'])).toEqual({ kind: 'no_broadcast_info' });
  });

  it('keeps an empty service list on the legacy path', () => {
    expect(resolveDestinations(game(['CBS']), [])).toEqual({ kind: 'legacy' });
    expect(resolveDestinations(game(['FOX']), [])).toEqual({ kind: 'legacy' });
  });

  it('returns the raw Peacock name and no link when that airing is unmapped', () => {
    expect(mapMediaName('Peacock')).toBeNull();
    expect(resolveDestinations(game(['Peacock']), ['peacock', 'youtube_tv', 'directv'])).toEqual({
      kind: 'unknown_network',
      raw: 'Peacock',
    });
  });

  it('still opens a saved link when the only airing is unmapped', () => {
    const result = resolveDestinations(
      game(['Peacock'], { savedUrl: 'https://example.com/live' }),
      ['peacock'],
    );
    expect(result).toMatchObject({
      kind: 'destinations',
      primary: { url: 'https://example.com/live' },
      alternates: [],
    });
  });

  it('resolves a mapped airing that shares the game with an unmapped name', () => {
    const result = resolveDestinations(game(['Peacock', 'CBS']), ['directv']);
    expect(result).toMatchObject({
      kind: 'destinations',
      primary: { url: CBS },
    });
  });
});

describe('resolveStoredDestination', () => {
  it('uses a stored Prime media name the mapper does not know', () => {
    const result = resolveStoredDestination({
      awayNickname: 'Bears',
      homeNickname: 'Falcons',
      kickoff: KICKOFF,
      airings: [{ network: 'amazon_prime', espnMediaName: 'AMAZON_PRIME' }],
      services: ['amazon_prime'],
      savedUrl: null,
      outOfMarketSunday: false,
    });
    expect(mapMediaName('AMAZON_PRIME')).toBeNull();
    expect(result).toMatchObject({ kind: 'destinations', primary: { url: PRIME } });
  });

  it('keeps a stored Peacock airing as unknown_network', () => {
    expect(
      resolveStoredDestination({
        awayNickname: 'Bears',
        homeNickname: 'Falcons',
        kickoff: KICKOFF,
        airings: [{ network: 'peacock', espnMediaName: 'Peacock' }],
        services: ['peacock', 'youtube_tv', 'directv'],
        savedUrl: null,
        outOfMarketSunday: false,
      }),
    ).toEqual({ kind: 'unknown_network', raw: 'Peacock' });
  });
});
