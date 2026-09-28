import {
  AIRING_NETWORKS,
  expandWatchOptions,
  isRegionalSlate,
  networkRank,
  rankWatchOptions,
  type AiringMarket,
  type AiringNetwork,
  type MarketConfidence,
  type ParsedAiring,
  type RouteHint,
  type SlateGame,
  type UserService,
} from '@pivot/shared';

/**
 * App-level landing per user service until the `(service, network)` deep-link table lands (B1.5).
 * Same URLs `scripts/seed-broadcasts.ts` writes for these apps; YouTube TV shares Sunday Ticket's
 * device-confirmed `/live` landing. None of these is a game-level link.
 */
export const USER_SERVICE_LANDING_URLS: Record<UserService, string> = {
  youtube_tv: 'https://tv.youtube.com/live',
  sunday_ticket: 'https://tv.youtube.com/live',
  hulu_live: 'https://www.hulu.com/hub/sports', // unverified AASA
  fubo: 'https://www.fubo.tv/', // unverified AASA
  directv: 'https://www.directv.com/', // unverified AASA
  sling: '', // no confirmed carriage, so never emitted
  amazon_prime: 'https://www.primevideo.com/',
  peacock: 'https://www.peacocktv.com/watch/sports',
  paramount_plus: 'https://www.paramountplus.com/',
  espn_plus: 'https://www.espn.com/nfl/team',
  nfl_plus: 'https://www.nfl.com/scores',
};

/** A `game_airings` row as selected by the games routes. */
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

/**
 * Per-game watch options and airings for a week slate (docs/B1-BROADCAST-DESIGN.md §1.6): airings →
 * `expandWatchOptions` → `rankWatchOptions`, keeping only services the user has. A user with no
 * services gets no options. Regional-slate detection needs every game of the week, so this builds
 * the whole slate at once.
 */
export function buildWeekWatch(
  games: readonly SlateGameRow[],
  airingRows: readonly AiringRow[],
  subscribedServices: ReadonlySet<string>,
): Map<string, GameWatch> {
  const airingsByGame = new Map<string, ParsedAiring[]>();
  for (const row of airingRows) {
    const airing = toParsedAiring(row);
    if (!airing) continue;
    const list = airingsByGame.get(row.game_id) ?? [];
    list.push(airing);
    airingsByGame.set(row.game_id, list);
  }

  const slate: SlateGame[] = games.map((game) => ({
    id: game.id,
    kickoff: new Date(game.scheduled_start),
    networks: (airingsByGame.get(game.id) ?? []).map((a) => a.network),
  }));

  const result = new Map<string, GameWatch>();
  for (const slateGame of slate) {
    const airings = airingsByGame.get(slateGame.id) ?? [];
    const regional = isRegionalSlate(slateGame, slate);

    const broadcasts = rankWatchOptions(
      expandWatchOptions(airings, slateGame.kickoff, regional),
      subscribedServices,
      regional,
    )
      .filter((option) => subscribedServices.has(option.service))
      .map((option): WireWatchOption => ({
        service: option.service,
        deep_link_url: USER_SERVICE_LANDING_URLS[option.service],
        requires_subscription: true,
        user_has_subscription: true,
        typical_lag_seconds: option.typicalLagSeconds,
        preferred: option.preferred,
        network: option.network,
        market_confidence: option.marketConfidence,
        ...(option.routeHint !== undefined ? { route_hint: option.routeHint } : {}),
      }));

    const wireAirings = airings
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

    result.set(slateGame.id, { broadcasts, airings: wireAirings });
  }
  return result;
}
