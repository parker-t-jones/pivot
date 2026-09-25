import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CARRIAGE_2026_1,
  expandWatchOptions,
  isRegionalSlate,
  mapMediaName,
  networkLabelFromAirings,
  parseEspnAirings,
  rankWatchOptions,
  type CarriageMapVersion,
  type EspnBroadcastEvent,
  type ParsedAiring,
  type SlateGame,
  type WatchOption,
} from './index.js';

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__/espn-scoreboard-2026-week3-broadcasts.json',
);

interface FixtureFile {
  events: EspnBroadcastEvent[];
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as FixtureFile;

/** Expected networks per shortName from docs/BROADCAST-DATA-RECON.md §3. */
const EXPECTED_BY_SHORT: Record<string, string[]> = {
  'ATL @ GB': ['amazon_prime'],
  'LAC @ BUF': ['fox'],
  'CAR @ CLE': ['fox'],
  'NYJ @ DET': ['fox'],
  'HOU @ IND': ['cbs'],
  'KC @ MIA': ['cbs'],
  'TEN @ NYG': ['cbs'],
  'CIN @ PIT': ['cbs'],
  'SEA @ WSH': ['fox'],
  'NE @ JAX': ['cbs'],
  'ARI @ SF': ['fox'],
  'MIN @ TB': ['fox'],
  'BAL VS DAL': ['cbs'],
  'LV @ NO': ['cbs'],
  'LAR @ DEN': ['nbc'],
  'PHI @ CHI': ['espn', 'abc'],
};

function eventByShort(shortName: string): EspnBroadcastEvent {
  const event = fixture.events.find((e) => e.shortName === shortName);
  if (!event) throw new Error(`missing fixture event ${shortName}`);
  return event;
}

function slateFromFixture(): SlateGame[] {
  return fixture.events.map((event) => {
    const airings = parseEspnAirings(event, () => undefined);
    return {
      id: event.id,
      kickoff: new Date(event.date ?? ''),
      networks: airings.map((a) => a.network),
    };
  });
}

function option(
  service: WatchOption['service'],
  network: WatchOption['network'],
  lag: number,
): WatchOption {
  return {
    service,
    network,
    requiresSubscription: true,
    marketConfidence: 'unknown',
    typicalLagSeconds: lag,
    preferred: false,
  };
}

describe('mapMediaName', () => {
  it('maps the §3.3 table exactly and rejects aliases', () => {
    expect(mapMediaName('CBS')).toBe('cbs');
    expect(mapMediaName('FOX')).toBe('fox');
    expect(mapMediaName('NBC')).toBe('nbc');
    expect(mapMediaName('ABC')).toBe('abc');
    expect(mapMediaName('ESPN')).toBe('espn');
    expect(mapMediaName('Prime Video')).toBe('amazon_prime');
    expect(mapMediaName('Prime')).toBeNull();
    expect(mapMediaName('Amazon')).toBeNull();
    expect(mapMediaName('XYZ Sports')).toBeNull();
  });
});

describe('parseEspnAirings', () => {
  it('maps all 16 Week 3 events to the recon table', () => {
    expect(fixture.events).toHaveLength(16);
    for (const event of fixture.events) {
      const short = event.shortName ?? '';
      const expected = EXPECTED_BY_SHORT[short];
      expect(expected, short).toBeDefined();
      const airings = parseEspnAirings(event, () => {
        throw new Error(`unexpected unmapped on ${short}`);
      });
      expect(
        airings.map((a) => a.network).sort(),
        short,
      ).toEqual([...(expected ?? [])].sort());
    }
  });

  it('maps TNF to amazon_prime and MNF to espn+abc', () => {
    expect(parseEspnAirings(eventByShort('ATL @ GB'), () => undefined).map((a) => a.network)).toEqual([
      'amazon_prime',
    ]);
    expect(
      parseEspnAirings(eventByShort('PHI @ CHI'), () => undefined)
        .map((a) => a.network)
        .sort(),
    ).toEqual(['abc', 'espn']);
  });

  it('logs an unmapped name and produces no row', () => {
    const logs: Array<{ eventId: string; rawName: string }> = [];
    const event: EspnBroadcastEvent = {
      id: 'test-unmapped',
      shortName: 'X @ Y',
      competitions: [
        {
          geoBroadcasts: [
            {
              type: { shortName: 'TV' },
              market: { type: 'National' },
              media: { shortName: 'XYZ Sports' },
            },
          ],
        },
      ],
    };
    const airings = parseEspnAirings(event, (info) => {
      logs.push({ eventId: info.eventId, rawName: info.rawName });
    });
    expect(airings).toEqual([]);
    expect(logs).toEqual([{ eventId: 'test-unmapped', rawName: 'XYZ Sports' }]);
  });

  it('falls back to broadcasts[].names[] and splits simulcast names', () => {
    const event: EspnBroadcastEvent = {
      id: 'fallback-mnf',
      shortName: 'PHI @ CHI',
      competitions: [
        {
          broadcast: 'ESPN/ABC',
          broadcasts: [{ market: 'national', names: ['ESPN', 'ABC'] }],
        },
      ],
    };
    const airings = parseEspnAirings(event, () => undefined);
    expect(airings.map((a) => a.network).sort()).toEqual(['abc', 'espn']);
    expect(airings.every((a) => a.espnType === null)).toBe(true);
  });

  it('never invents rows from the singular broadcast string alone', () => {
    const event: EspnBroadcastEvent = {
      id: 'broadcast-only',
      competitions: [{ broadcast: 'ESPN/ABC' }],
    };
    expect(parseEspnAirings(event, () => undefined)).toEqual([]);
  });
});

describe('networkLabelFromAirings', () => {
  it('picks ESPN over ABC on MNF', () => {
    expect(networkLabelFromAirings([{ network: 'espn' }, { network: 'abc' }])).toBe('ESPN');
    expect(networkLabelFromAirings([{ network: 'abc' }, { network: 'espn' }])).toBe('ESPN');
  });

  it('returns null for an empty list', () => {
    expect(networkLabelFromAirings([])).toBeNull();
  });

  it('ignores an unknown key', () => {
    expect(networkLabelFromAirings([{ network: 'some_new_service' }])).toBeNull();
    expect(
      networkLabelFromAirings([{ network: 'some_new_service' }, { network: 'nbc' }]),
    ).toBe('NBC');
  });
});

describe('isRegionalSlate', () => {
  const slate = slateFromFixture();

  function game(shortName: string): SlateGame {
    const event = eventByShort(shortName);
    const found = slate.find((g) => g.id === event.id);
    if (!found) throw new Error(shortName);
    return found;
  }

  it('marks the Week 3 Sunday 1pm FOX bucket regional', () => {
    expect(isRegionalSlate(game('LAC @ BUF'), slate)).toBe(true);
    expect(isRegionalSlate(game('SEA @ WSH'), slate)).toBe(true);
  });

  it('marks Sunday 1pm CBS regional', () => {
    expect(isRegionalSlate(game('HOU @ IND'), slate)).toBe(true);
  });

  it('does not mark SNF, MNF, or TNF as regional', () => {
    expect(isRegionalSlate(game('LAR @ DEN'), slate)).toBe(false);
    expect(isRegionalSlate(game('PHI @ CHI'), slate)).toBe(false);
    expect(isRegionalSlate(game('ATL @ GB'), slate)).toBe(false);
  });
});

describe('expandWatchOptions + rankWatchOptions', () => {
  const foxAiring: ParsedAiring = {
    network: 'fox',
    market: 'national',
    espnMediaName: 'FOX',
    espnType: 'TV',
  };
  const sundayEarly = new Date('2026-09-27T17:00:00Z'); // 1pm ET
  const snfKickoff = new Date('2026-09-28T00:20:00Z'); // 8:20pm ET Sunday

  it('ranks Ticket before YTTV on a regional FOX game and tags the local route', () => {
    const options = expandWatchOptions([foxAiring], sundayEarly, true);
    const ranked = rankWatchOptions(
      options,
      new Set(['sunday_ticket', 'youtube_tv']),
      true,
    );
    expect(ranked[0]?.service).toBe('sunday_ticket');
    expect(ranked[0]?.preferred).toBe(true);
    expect(ranked[1]?.service).toBe('youtube_tv');
    expect(ranked[1]?.routeHint).toBe('in_market_local');
    expect(ranked[1]?.preferred).toBe(false);
  });

  it('uses lag on a non-regional slate with no route hint', () => {
    // Constructed pair — Ticket does not expand onto SNF NBC; ranking rule still applies.
    const pair = [
      option('sunday_ticket', 'fox', 75),
      option('youtube_tv', 'fox', 45),
    ];
    const ranked = rankWatchOptions(pair, new Set(['sunday_ticket', 'youtube_tv']), false);
    expect(ranked.map((o) => o.service)).toEqual(['youtube_tv', 'sunday_ticket']);
    expect(ranked[0]?.preferred).toBe(true);
    expect(ranked.every((o) => o.routeHint === undefined)).toBe(true);
  });

  it('emits no options when only Prime is subscribed on a Sunday FOX game', () => {
    const options = expandWatchOptions([foxAiring], sundayEarly, true);
    const ranked = rankWatchOptions(options, new Set(['amazon_prime']), true);
    expect(ranked.every((o) => !o.preferred)).toBe(true);
    expect(ranked.find((o) => o.service === 'amazon_prime')).toBeUndefined();
  });

  it('sets no preferred option when the user has no services', () => {
    const options = expandWatchOptions([foxAiring], sundayEarly, true);
    const ranked = rankWatchOptions(options, new Set(), true);
    expect(ranked.some((o) => o.preferred)).toBe(false);
  });

  it('never emits an unconfirmed carriage entry', () => {
    const carriage: CarriageMapVersion = {
      version: 'test',
      effectiveFrom: '2026-01-01',
      entries: [
        {
          service: 'sling',
          networks: ['fox'],
          marketRule: 'in_market',
          requiresSubscription: true,
          confirmed: false,
        },
        {
          service: 'youtube_tv',
          networks: ['fox'],
          marketRule: 'in_market',
          requiresSubscription: true,
          confirmed: true,
        },
      ],
    };
    const options = expandWatchOptions([foxAiring], sundayEarly, true, carriage);
    expect(options.map((o) => o.service)).toEqual(['youtube_tv']);
  });

  it('collapses a simulcast to one option per service preferring ESPN', () => {
    const mnf: ParsedAiring[] = [
      { network: 'espn', market: 'national', espnMediaName: 'ESPN', espnType: 'TV' },
      { network: 'abc', market: 'national', espnMediaName: 'ABC', espnType: 'TV' },
    ];
    const options = expandWatchOptions(mnf, new Date('2026-09-29T00:15:00Z'), false);
    const yttv = options.filter((o) => o.service === 'youtube_tv');
    expect(yttv).toHaveLength(1);
    expect(yttv[0]?.network).toBe('espn');
  });

  it('does not expand sunday_ticket onto SNF', () => {
    const nbc: ParsedAiring = {
      network: 'nbc',
      market: 'national',
      espnMediaName: 'NBC',
      espnType: 'TV',
    };
    const options = expandWatchOptions([nbc], snfKickoff, false);
    expect(options.find((o) => o.service === 'sunday_ticket')).toBeUndefined();
    expect(options.find((o) => o.service === 'youtube_tv')?.network).toBe('nbc');
  });
});

describe('CARRIAGE_2026_1', () => {
  it('keeps Sling empty and unconfirmed', () => {
    const sling = CARRIAGE_2026_1.entries.find((e) => e.service === 'sling');
    expect(sling?.networks).toEqual([]);
    expect(sling?.confirmed).toBe(false);
  });
});
