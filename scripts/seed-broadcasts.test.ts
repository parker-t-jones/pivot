import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { EspnBroadcastEvent } from '@pivot/shared';
import {
  BROADCAST_TEMPLATES,
  DEFAULT_SCOREBOARD_PATH,
  buildNetworkRows,
  espnGameExternalId,
  parseScoreboardSource,
} from './seed-broadcasts.js';

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../shared/src/broadcast/__fixtures__/espn-scoreboard-2026-week3-broadcasts.json',
);
const week3 = (JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as { events: EspnBroadcastEvent[] }).events;

/** Every fixture event joined to a game whose id is its ESPN event id. */
const allGames = new Map(week3.map((event) => [espnGameExternalId(event.id), event.id]));

function servicesFor(rows: ReturnType<typeof buildNetworkRows>['rows'], gameId: string): string[] {
  return rows.filter((row) => row.game_id === gameId).map((row) => row.service);
}

describe('parseScoreboardSource', () => {
  it('defaults to the saved Week 3 scoreboard', () => {
    expect(parseScoreboardSource([])).toEqual({ kind: 'file', path: DEFAULT_SCOREBOARD_PATH });
  });

  it('accepts --live or one path, not both', () => {
    expect(parseScoreboardSource(['--live'])).toEqual({ kind: 'live' });
    expect(parseScoreboardSource(['x.json'])).toEqual({ kind: 'file', path: path.resolve('x.json') });
    expect(() => parseScoreboardSource(['--live', 'x.json'])).toThrow(/mutually exclusive/);
    expect(() => parseScoreboardSource(['--bogus'])).toThrow(/unknown flag/);
  });
});

describe('buildNetworkRows', () => {
  it('writes the real Week 3 networks, network-only', () => {
    const { rows, unmatchedEventIds } = buildNetworkRows(week3, allGames, vi.fn());

    expect(unmatchedEventIds).toEqual([]);
    expect(servicesFor(rows, '401872948')).toEqual(['amazon_prime']); // ATL @ GB (TNF)
    expect(servicesFor(rows, '401872962')).toEqual(['nbc']); // LAR @ DEN (SNF)
    expect(servicesFor(rows, '401872963')).toEqual(['abc']); // PHI @ CHI (MNF)
    expect(rows.some((row) => row.service === 'sunday_ticket' || row.service === 'nfl_plus')).toBe(false);
    expect(rows).toHaveLength(16);
  });

  it('skips espn airings (not a game_broadcasts service) and reports them', () => {
    const { skipped } = buildNetworkRows(week3, allGames, vi.fn());
    expect(skipped).toEqual([{ eventId: '401872963', shortName: 'PHI @ CHI', network: 'espn' }]);
  });

  it('uses the service template for the deep link and subscription flag', () => {
    const { rows } = buildNetworkRows(week3, allGames, vi.fn());
    expect(rows.find((row) => row.game_id === '401872948')).toEqual({
      game_id: '401872948',
      service: 'amazon_prime',
      deep_link_url: BROADCAST_TEMPLATES['amazon_prime']?.deepLinkUrl,
      requires_subscription: true,
    });
  });

  it('reports events with no seeded game instead of writing them', () => {
    const onlyTnf = new Map([[espnGameExternalId('401872948'), 'g-tnf']]);
    const { rows, unmatchedEventIds } = buildNetworkRows(week3, onlyTnf, vi.fn());
    expect(rows.map((row) => row.game_id)).toEqual(['g-tnf']);
    expect(unmatchedEventIds).toHaveLength(15);
  });

  it('writes nothing for an unmapped media name and logs it', () => {
    const log = vi.fn();
    const event: EspnBroadcastEvent = {
      id: '1',
      shortName: 'A @ B',
      competitions: [{ geoBroadcasts: [{ media: { shortName: 'XYZ Sports' } }] }],
    };
    const { rows } = buildNetworkRows([event], new Map([[espnGameExternalId('1'), 'g']]), log);
    expect(rows).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ rawName: 'XYZ Sports' }));
  });
});

describe('BROADCAST_TEMPLATES', () => {
  it('includes YouTube TV plus the vMVPD catalog as paid app-level landings', () => {
    expect(BROADCAST_TEMPLATES['sunday_ticket']?.deepLinkUrl).toBe('https://tv.youtube.com/live');
    expect(BROADCAST_TEMPLATES['hulu']).toEqual({
      service: 'hulu',
      deepLinkUrl: 'https://www.hulu.com/hub/sports',
      requiresSubscription: true,
    });
    expect(BROADCAST_TEMPLATES['fubo']).toEqual({
      service: 'fubo',
      deepLinkUrl: 'https://www.fubo.tv/',
      requiresSubscription: true,
    });
    expect(BROADCAST_TEMPLATES['directv']).toEqual({
      service: 'directv',
      deepLinkUrl: 'https://www.directv.com/',
      requiresSubscription: true,
    });
  });
});
