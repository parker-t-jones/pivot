import { describe, expect, it } from 'vitest';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import { SupabaseBroadcastCatalog, SupabaseGameAiringsStore } from './supabaseCatalogs.js';

type Row = Record<string, unknown>;

/** Just enough of the query builder for the broadcast catalog: select → eq/in filters → rows. */
function fakeClient(tables: Record<string, Row[]>): SupabaseServiceClient {
  return {
    from(table: string) {
      let rows = tables[table] ?? [];
      const query = {
        select: () => query,
        eq(column: string, value: unknown) {
          rows = rows.filter((row) => row[column] === value);
          return query;
        },
        in(column: string, values: unknown[]) {
          rows = rows.filter((row) => values.includes(row[column]));
          return query;
        },
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        then(resolve: (result: { data: Row[]; error: null }) => unknown) {
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return query;
    },
  } as unknown as SupabaseServiceClient;
}

function airing(gameId: string, network: string): Row {
  return {
    game_id: gameId,
    network,
    market: 'national',
    espn_media_name: network.toUpperCase(),
    espn_type: 'TV',
  };
}

const TABLES: Record<string, Row[]> = {
  games: [
    { id: 'fox1', week: 3, season_type: 'regular', scheduled_start: '2026-09-27T17:00:00Z' },
    { id: 'fox2', week: 3, season_type: 'regular', scheduled_start: '2026-09-27T17:00:00Z' },
    { id: 'pre3', week: 3, season_type: 'pre', scheduled_start: '2026-08-20T23:00:00Z' },
    { id: 'wk4', week: 4, season_type: 'regular', scheduled_start: '2026-10-04T17:00:00Z' },
  ],
  game_airings: [
    airing('fox1', 'fox'),
    airing('fox2', 'fox'),
    airing('pre3', 'fox'),
    airing('wk4', 'fox'),
    airing('fox1', 'dumont'),
  ],
  user_app_presence: [
    { user_id: 'u1', service: 'youtube_tv', has_subscription: true },
    { user_id: 'u1', service: 'sunday_ticket', has_subscription: false },
    { user_id: 'u2', service: 'peacock', has_subscription: true },
  ],
};

describe('SupabaseBroadcastCatalog', () => {
  const catalog = new SupabaseBroadcastCatalog(fakeClient(TABLES));

  it("loads the game's week and season type with catalog airings only", async () => {
    const week = await catalog.getWeekAirings('fox1');
    expect(week.map((game) => [game.id, game.airings.map((a) => a.network)])).toEqual([
      ['fox1', ['fox']],
      ['fox2', ['fox']],
    ]);
    expect(week[0]?.kickoff).toEqual(new Date('2026-09-27T17:00:00Z'));
  });

  it('returns no week for an unknown game', async () => {
    expect(await catalog.getWeekAirings('missing')).toEqual([]);
  });

  it('counts only services with has_subscription', async () => {
    expect([...(await catalog.getUserSubscribedServices('u1'))]).toEqual(['youtube_tv']);
  });
});

describe('SupabaseGameAiringsStore', () => {
  const store = new SupabaseGameAiringsStore(
    fakeClient({
      games: [
        { id: 'g1', sportradar_id: 'seed:espn:401' },
        { id: 'g2', sportradar_id: 'seed:espn:402' },
      ],
      game_airings: [
        { id: 'a1', game_id: 'g1', network: 'fox', market: 'regional' },
        { id: 'a2', game_id: 'g2', network: 'cbs', market: 'regional' },
      ],
    }),
  );

  it('maps the seeded ESPN external ids that exist to game ids', async () => {
    expect(await store.gameIdsByExternalId(['seed:espn:401', 'seed:espn:999'])).toEqual(
      new Map([['seed:espn:401', 'g1']]),
    );
  });

  it("lists only that game's airing keys", async () => {
    expect((await store.listForGame('g1')).map((row) => row.id)).toEqual(['a1']);
  });
});
