import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { EspnBroadcastEvent } from '@pivot/shared';
import {
  DEFAULT_SCOREBOARD_PATH,
  airingSourceFor,
  buildAiringRows,
  espnGameExternalId,
  parseScoreboardSource,
  writeGameAirings,
  type AiringSeedRow,
  type GameAiringsStore,
  type StoredAiringKey,
} from './seed-broadcasts.js';

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../shared/src/broadcast/__fixtures__/espn-scoreboard-2026-week3-broadcasts.json',
);
const week3 = (JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as { events: EspnBroadcastEvent[] }).events;

/** Every fixture event joined to a game whose id is its ESPN event id. */
const allGames = new Map(week3.map((event) => [espnGameExternalId(event.id), event.id]));

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

const FETCHED_AT = '2026-09-27T12:00:00.000Z';

describe('airingSourceFor', () => {
  it('tags a saved payload as a fixture and --live as a real scoreboard read', () => {
    expect(airingSourceFor({ kind: 'file', path: DEFAULT_SCOREBOARD_PATH })).toBe('espn_scoreboard_fixture');
    expect(airingSourceFor({ kind: 'live' })).toBe('espn_scoreboard');
  });
});

describe('buildAiringRows', () => {
  function networksFor(rowsByGame: Map<string, AiringSeedRow[]>, gameId: string): string[] {
    return (rowsByGame.get(gameId) ?? []).map((row) => row.network);
  }

  it('maps the Week 3 scoreboard to one row per (network, market) per game', () => {
    const { rowsByGame, unmatchedEventIds } = buildAiringRows(
      week3,
      allGames,
      'espn_scoreboard_fixture',
      FETCHED_AT,
      vi.fn(),
    );

    expect(unmatchedEventIds).toEqual([]);
    expect(rowsByGame.size).toBe(16);
    expect(rowsByGame.get('401872948')).toEqual([
      {
        game_id: '401872948',
        network: 'amazon_prime',
        market: 'national',
        source: 'espn_scoreboard_fixture',
        espn_media_name: 'Prime Video',
        espn_type: 'Streaming',
        fetched_at: FETCHED_AT,
      },
    ]); // ATL @ GB (TNF)
    expect(networksFor(rowsByGame, '401872963')).toEqual(['espn', 'abc']); // PHI @ CHI (MNF)
    expect(networksFor(rowsByGame, '401872962')).toEqual(['nbc']); // LAR @ DEN (SNF)
  });

  it('collapses a repeated (network, market) within one event', () => {
    const event: EspnBroadcastEvent = {
      id: '1',
      competitions: [
        {
          geoBroadcasts: [
            { media: { shortName: 'FOX' }, market: { type: 'Regional' } },
            { media: { shortName: 'FOX' }, market: { type: 'Regional' } },
            { media: { shortName: 'FOX' }, market: { type: 'National' } },
          ],
        },
      ],
    };
    const { rowsByGame } = buildAiringRows(
      [event],
      new Map([[espnGameExternalId('1'), 'g']]),
      'espn_scoreboard_fixture',
      FETCHED_AT,
      vi.fn(),
    );
    expect(rowsByGame.get('g')?.map((row) => `${row.network}|${row.market}`)).toEqual([
      'fox|regional',
      'fox|national',
    ]);
  });

  it('keeps a matched game with no mappable airings as an empty candidate list', () => {
    const log = vi.fn();
    const event: EspnBroadcastEvent = {
      id: '1',
      competitions: [{ geoBroadcasts: [{ media: { shortName: 'XYZ Sports' } }] }],
    };
    const { rowsByGame } = buildAiringRows(
      [event],
      new Map([[espnGameExternalId('1'), 'g']]),
      'espn_scoreboard_fixture',
      FETCHED_AT,
      log,
    );
    expect(rowsByGame.get('g')).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ rawName: 'XYZ Sports' }));
  });

  it('reports events with no seeded game instead of writing them', () => {
    const onlyTnf = new Map([[espnGameExternalId('401872948'), 'g-tnf']]);
    const { rowsByGame, unmatchedEventIds } = buildAiringRows(
      week3,
      onlyTnf,
      'espn_scoreboard_fixture',
      FETCHED_AT,
      vi.fn(),
    );
    expect([...rowsByGame.keys()]).toEqual(['g-tnf']);
    expect(unmatchedEventIds).toHaveLength(15);
  });
});

/** In-memory `game_airings` honouring UNIQUE (game_id, network, market) with ON CONFLICT DO UPDATE. */
class FakeAiringsStore implements GameAiringsStore {
  rows: (AiringSeedRow & { id: string })[] = [];
  private nextId = 1;

  async upsert(rows: readonly AiringSeedRow[]): Promise<void> {
    for (const row of rows) {
      const existing = this.rows.find(
        (r) => r.game_id === row.game_id && r.network === row.network && r.market === row.market,
      );
      if (existing) Object.assign(existing, row);
      else this.rows.push({ ...row, id: `a${this.nextId++}` });
    }
  }

  async listForGame(gameId: string): Promise<StoredAiringKey[]> {
    return this.rows
      .filter((r) => r.game_id === gameId)
      .map(({ id, network, market }) => ({ id, network, market }));
  }

  async deleteByIds(ids: readonly string[]): Promise<void> {
    this.rows = this.rows.filter((r) => !ids.includes(r.id));
  }
}

function airing(gameId: string, network: AiringSeedRow['network'], market: AiringSeedRow['market'], fetchedAt = FETCHED_AT): AiringSeedRow {
  return {
    game_id: gameId,
    network,
    market,
    source: 'espn_scoreboard_fixture',
    espn_media_name: network.toUpperCase(),
    espn_type: 'TV',
    fetched_at: fetchedAt,
  };
}

describe('writeGameAirings', () => {
  it('inserts the candidates on first write', async () => {
    const store = new FakeAiringsStore();
    const result = await writeGameAirings(store, 'g1', [airing('g1', 'espn', 'national'), airing('g1', 'abc', 'national')]);
    expect(result).toEqual({ upserted: 2, deleted: 0 });
    expect(store.rows.map((r) => r.network)).toEqual(['espn', 'abc']);
  });

  it('is idempotent: a re-run keeps the same rows and refreshes fetched_at', async () => {
    const store = new FakeAiringsStore();
    await writeGameAirings(store, 'g1', [airing('g1', 'fox', 'regional')]);
    const [before] = store.rows;
    const result = await writeGameAirings(store, 'g1', [airing('g1', 'fox', 'regional', '2026-09-27T12:15:00.000Z')]);
    expect(result).toEqual({ upserted: 1, deleted: 0 });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.id).toBe(before?.id);
    expect(store.rows[0]?.fetched_at).toBe('2026-09-27T12:15:00.000Z');
  });

  it('drops the stale network on a flex (FOX → NBC) without touching other games', async () => {
    const store = new FakeAiringsStore();
    await writeGameAirings(store, 'g1', [airing('g1', 'fox', 'regional')]);
    await writeGameAirings(store, 'g2', [airing('g2', 'fox', 'regional')]);

    const result = await writeGameAirings(store, 'g1', [airing('g1', 'nbc', 'national')]);

    expect(result).toEqual({ upserted: 1, deleted: 1 });
    expect(store.rows.map((r) => `${r.game_id}:${r.network}`).sort()).toEqual(['g1:nbc', 'g2:fox']);
  });

  it('treats a changed market as a different airing', async () => {
    const store = new FakeAiringsStore();
    await writeGameAirings(store, 'g1', [airing('g1', 'cbs', 'unknown')]);
    await writeGameAirings(store, 'g1', [airing('g1', 'cbs', 'regional')]);
    expect(store.rows.map((r) => `${r.network}|${r.market}`)).toEqual(['cbs|regional']);
  });

  it('clears a game whose candidate list is empty', async () => {
    const store = new FakeAiringsStore();
    await writeGameAirings(store, 'g1', [airing('g1', 'cbs', 'regional')]);
    expect(await writeGameAirings(store, 'g1', [])).toEqual({ upserted: 0, deleted: 1 });
    expect(store.rows).toEqual([]);
  });

  it('rejects rows that belong to another game', async () => {
    await expect(writeGameAirings(new FakeAiringsStore(), 'g1', [airing('g2', 'cbs', 'regional')])).rejects.toThrow(
      /game g1/,
    );
  });
});
