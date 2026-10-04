import {
  AIRING_NETWORKS,
  isRegionalSlate,
  networkRank,
  toSlateGame,
  serviceWatchUrl,
  watchOptionsForGame,
  type AiringMarket,
  type AiringNetwork,
  type MarketConfidence,
  type ParsedAiring,
  type RouteHint,
  type UserService,
  type WeekGameAirings,
} from '@pivot/shared';

/** A `game_airings` row as selected by the games routes and the runner's broadcast catalog. */
export interface AiringRow {
  game_id: string;
  network: string;
  market: string;
  espn_media_name: string;
  espn_type: string | null;
}

export interface SlateGameRow {
  id: string;
  scheduled_start: string;
  away_team_name?: string;
  home_team_name?: string;
}

export interface WireWatchOption {
  service: UserService;
  deep_link_url: string;
  requires_subscription: true;
  user_has_subscription: true;
  typical_lag_seconds: number;
  preferred: boolean;
  network: AiringNetwork;
  market_confidence: MarketConfidence;
  route_hint?: RouteHint;
}

export interface WireAiring {
  network: AiringNetwork;
  market: AiringMarket;
  market_confidence: MarketConfidence;
}

export interface GameWatch {
  broadcasts: WireWatchOption[];
  airings: WireAiring[];
}

export const AIRING_COLUMNS = 'game_id, network, market, espn_media_name, espn_type';

const AIRING_NETWORK_SET = new Set<string>(AIRING_NETWORKS);
const REGIONAL_NETWORKS = new Set<AiringNetwork>(['cbs', 'fox']);

function toParsedAiring(row: AiringRow): ParsedAiring | null {
  if (!AIRING_NETWORK_SET.has(row.network)) return null;
  const market: AiringMarket =
    row.market === 'national' || row.market === 'regional' ? row.market : 'unknown';
  return {
    network: row.network as AiringNetwork,
    market,
    espnMediaName: row.espn_media_name,
    espnType: row.espn_type,
  };
}

/** A week's games with their `game_airings` rows attached. Rows outside the catalog are dropped. */
export function weekGameAirings(
  games: readonly SlateGameRow[],
  airingRows: readonly AiringRow[],
): WeekGameAirings[] {
  const airingsByGame = new Map<string, ParsedAiring[]>();
  for (const row of airingRows) {
    const airing = toParsedAiring(row);
    if (!airing) continue;
    const list = airingsByGame.get(row.game_id) ?? [];
    list.push(airing);
    airingsByGame.set(row.game_id, list);
  }
  return games.map((game) => ({
    id: game.id,
    kickoff: new Date(game.scheduled_start),
    airings: airingsByGame.get(game.id) ?? [],
  }));
}

/**
 * Per-game watch options and airings for a week slate (docs/B1-BROADCAST-DESIGN.md §1.6), ranked by
 * the shared `watchOptionsForGame`. A user with no services gets no options. Regional-slate
 * detection needs every game of the week, so this builds the whole slate at once.
 */
export function buildWeekWatch(
  games: readonly SlateGameRow[],
  airingRows: readonly AiringRow[],
  subscribedServices: ReadonlySet<string>,
): Map<string, GameWatch> {
  const week = weekGameAirings(games, airingRows);
  const slate = week.map(toSlateGame);
  const namesById = new Map(
    games.map((game) => [
      game.id,
      { away: game.away_team_name ?? '', home: game.home_team_name ?? '' },
    ]),
  );

  const result = new Map<string, GameWatch>();
  for (const game of week) {
    const regional = isRegionalSlate(toSlateGame(game), slate);
    const names = namesById.get(game.id);

    const broadcasts = watchOptionsForGame(game.id, week, subscribedServices).map(
      (option): WireWatchOption => ({
        service: option.service,
        deep_link_url: serviceWatchUrl({
          service: option.service,
          awayNickname: names?.away ?? '',
          homeNickname: names?.home ?? '',
          kickoff: game.kickoff,
          network: option.network,
        }),
        requires_subscription: true,
        user_has_subscription: true,
        typical_lag_seconds: option.typicalLagSeconds,
        preferred: option.preferred,
        network: option.network,
        market_confidence: option.marketConfidence,
        ...(option.routeHint !== undefined ? { route_hint: option.routeHint } : {}),
      }),
    );

    const wireAirings = game.airings
      .map((airing): WireAiring => ({
        network: airing.network,
        market: airing.market,
        market_confidence: regional && REGIONAL_NETWORKS.has(airing.network) ? 'unknown' : 'national',
      }))
      .sort(
        (a, b) =>
          (networkRank(a.network) ?? Number.MAX_SAFE_INTEGER) -
          (networkRank(b.network) ?? Number.MAX_SAFE_INTEGER),
      );

    result.set(game.id, { broadcasts, airings: wireAirings });
  }
  return result;
}
