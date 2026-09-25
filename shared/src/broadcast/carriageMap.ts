import type { CarriageMapVersion } from './types.js';

/**
 * Carriage map 2026.1 (docs/B1-BROADCAST-DESIGN.md §1.5).
 * Expansion uses only `confirmed: true` entries — see experiments/carriage-confirm.md.
 */
export const CARRIAGE_2026_1: CarriageMapVersion = {
  version: '2026.1',
  effectiveFrom: '2026-09-01',
  entries: [
    {
      service: 'youtube_tv',
      networks: ['cbs', 'fox', 'nbc', 'abc', 'espn', 'nfl_network'],
      marketRule: 'in_market',
      requiresSubscription: true,
      confirmed: true,
    },
    {
      service: 'sunday_ticket',
      networks: ['cbs', 'fox'],
      windows: ['SUNDAY · EARLY', 'SUNDAY · LATE'],
      marketRule: 'out_of_market',
      requiresSubscription: true,
      confirmed: true,
    },
    {
      service: 'hulu_live',
      networks: ['cbs', 'fox', 'nbc', 'abc', 'espn', 'nfl_network'],
      marketRule: 'in_market',
      requiresSubscription: true,
      confirmed: true,
    },
    {
      service: 'fubo',
      networks: ['cbs', 'fox', 'nbc', 'abc', 'espn', 'nfl_network'],
      marketRule: 'in_market',
      requiresSubscription: true,
      confirmed: true,
    },
    {
      service: 'directv',
      networks: ['cbs', 'fox', 'nbc', 'abc', 'espn', 'nfl_network'],
      marketRule: 'in_market',
      requiresSubscription: true,
      confirmed: true,
    },
    // Sling: key exists, empty carriage until package probe (§9.5).
    {
      service: 'sling',
      networks: [],
      marketRule: 'in_market',
      requiresSubscription: true,
      confirmed: false,
    },
    {
      service: 'amazon_prime',
      networks: ['amazon_prime'],
      marketRule: 'any',
      requiresSubscription: true,
      confirmed: true,
    },
    {
      service: 'peacock',
      networks: ['peacock'],
      marketRule: 'any',
      requiresSubscription: true,
      confirmed: true,
    },
    {
      service: 'paramount_plus',
      networks: ['paramount_plus'],
      marketRule: 'any',
      requiresSubscription: true,
      confirmed: true,
    },
    {
      service: 'espn_plus',
      networks: ['espn_plus'],
      marketRule: 'any',
      requiresSubscription: true,
      confirmed: true,
    },
    {
      service: 'nfl_plus',
      networks: ['nfl_plus', 'nfl_network'],
      marketRule: 'any',
      requiresSubscription: true,
      confirmed: true,
    },
  ],
};
