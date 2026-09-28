import { describe, expect, it } from 'vitest';
import type { AiringNetwork, WeekGameAirings } from '@pivot/shared';
import {
  InMemoryBroadcastCatalog,
  pickBroadcastSource,
  resolveLikelyBroadcastSource,
} from './broadcastLag.js';

function game(id: string, kickoff: string, networks: AiringNetwork[]): WeekGameAirings {
  return {
    id,
    kickoff: new Date(kickoff),
    airings: networks.map((network) => ({
      network,
      market: 'national',
      espnMediaName: network.toUpperCase(),
      espnType: 'TV',
    })),
  };
}

/** Week 3 shape: TNF on Prime, two 1pm FOX games (a regional split), MNF on ESPN + ABC. */
const WEEK: WeekGameAirings[] = [
  game('tnf', '2026-09-25T00:15:00Z', ['amazon_prime']),
  game('fox1', '2026-09-27T17:00:00Z', ['fox']),
  game('fox2', '2026-09-27T17:00:00Z', ['fox']),
  game('mnf', '2026-09-29T00:15:00Z', ['espn', 'abc']),
];

describe('pickBroadcastSource', () => {
  it('returns null when the user has no service carrying the game', () => {
    expect(pickBroadcastSource('tnf', WEEK, new Set(['youtube_tv']))).toBeNull();
    expect(pickBroadcastSource('fox1', WEEK, new Set())).toBeNull();
  });

  it('carries FOX through YouTube TV', () => {
    expect(pickBroadcastSource('fox1', WEEK, new Set(['youtube_tv']))).toMatchObject({
      service: 'youtube_tv',
      network: 'fox',
      preferred: true,
    });
  });

  it('takes Sunday Ticket over YouTube TV on a regional FOX game', () => {
    expect(
      pickBroadcastSource('fox1', WEEK, new Set(['youtube_tv', 'sunday_ticket']))?.service,
    ).toBe('sunday_ticket');
  });

  it('names the ESPN airing on MNF', () => {
    expect(pickBroadcastSource('mnf', WEEK, new Set(['youtube_tv']))?.network).toBe('espn');
  });

  it('returns null for a game outside the week', () => {
    expect(pickBroadcastSource('missing', WEEK, new Set(['youtube_tv']))).toBeNull();
  });
});

describe('resolveLikelyBroadcastSource', () => {
  it('loads the week and presence from the catalog', async () => {
    const catalog = new InMemoryBroadcastCatalog();
    catalog.setWeekAirings(WEEK);
    catalog.setUserSubscribedServices('u1', ['amazon_prime']);

    const likely = await resolveLikelyBroadcastSource('tnf', 'u1', catalog);
    expect(likely.source?.service).toBe('amazon_prime');
    expect(likely.airings.map((a) => a.network)).toEqual(['amazon_prime']);
  });

  it('returns the airings even when the user has no option', async () => {
    const catalog = new InMemoryBroadcastCatalog();
    catalog.setWeekAirings(WEEK);
    catalog.setUserSubscribedServices('u1', ['youtube_tv']);

    const likely = await resolveLikelyBroadcastSource('tnf', 'u1', catalog);
    expect(likely.source).toBeNull();
    expect(likely.airings.map((a) => a.network)).toEqual(['amazon_prime']);
  });

  it('returns nothing when the catalog has no data for the game or user', async () => {
    const catalog = new InMemoryBroadcastCatalog();
    expect(await resolveLikelyBroadcastSource('missing-game', 'missing-user', catalog)).toEqual({
      source: null,
      airings: [],
    });
  });
});
