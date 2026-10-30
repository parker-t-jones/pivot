import { mapMediaName } from './mapMediaName.js';
import { USER_SERVICES, type AiringNetwork, type UserService } from './types.js';
import { serviceWatchUrl } from './watchLinks.js';

/** Picker values. `espn` is the ESPN app (`espn.com/watch`), not `espn_plus`. */
export type ResolverService = UserService;

/** One https destination. `verified` is the manual-check flag from the network table. */
export interface WatchDestination {
  url: string;
  verified: boolean;
  note: string;
}

export type DestinationResolution =
  | { kind: 'destinations'; primary: WatchDestination; alternates: WatchDestination[] }
  | { kind: 'unavailable'; reason: 'not_on_your_services' }
  | { kind: 'unknown_network'; raw: string }
  | { kind: 'no_broadcast_info' }
  | { kind: 'legacy' };

export interface DestinationGame {
  awayNickname: string;
  homeNickname: string;
  kickoff: Date | null;
  /** ESPN `broadcasts[].names[]` or `geoBroadcasts[].media.shortName`, in payload order. */
  airings: readonly { rawName: string }[];
  /**
   * `user_game_links.url` for this user and game, or null when the row is absent.
   * Gate 5 fills this from one week query on `GET /games`, and from the dispatcher's
   * existing lookup (300ms cap, then send without it) for both the iOS and web payloads.
   */
  savedUrl: string | null;
  /**
   * Regional Sunday CBS/FOX slate, where `rankWatchOptions` puts Sunday Ticket
   * ahead of YouTube TV.
   */
  outOfMarketSunday: boolean;
}

interface StaticDestination {
  verified: boolean;
  note: string;
  url: string;
}

interface QueryDestination {
  verified: boolean;
  note: string;
  base: string;
  query: string;
}

type DestinationTemplate = StaticDestination | QueryDestination;

/**
 * Network live links and network-app landings. `{away}` / `{home}` in a query
 * are nicknames; the whole phrase is encoded once.
 */
export const DESTINATION_TABLE = {
  abc: {
    verified: true,
    note: 'Straight to the local ABC stream.',
    url: 'https://abc.com/watch-live/b2f23a6e-a2a4-4d63-bd3b-e330921b0942',
  },
  cbs: {
    verified: true,
    note: 'Local CBS, then one Live Local tap.',
    url: 'https://www.cbs.com/live-tv/stream/',
  },
  nbc: {
    verified: true,
    note: 'Straight to local NBC. Do not add callsign.',
    url: 'https://www.nbc.com/live?brand=nbc',
  },
  foxSearch: {
    verified: true,
    note: 'FOX LIVE tile, then Watch live. Away at Home nicknames.',
    base: 'https://www.fox.com/search?q=',
    query: '{away} at {home}',
  },
  foxChannels: {
    verified: true,
    note: 'FOX channel guide, one tap.',
    url: 'https://www.fox.com/live/channels',
  },
  espn: {
    verified: false,
    note: 'ESPN watch. ESPN airings only.',
    url: 'https://www.espn.com/watch/',
  },
  paramountPlus: {
    verified: false,
    note: 'Paramount+ live TV.',
    url: 'https://www.paramountplus.com/live-tv/',
  },
  peacock: {
    verified: false,
    note: 'Peacock sports landing.',
    url: 'https://www.peacocktv.com/watch/sports',
  },
} as const satisfies Record<string, DestinationTemplate>;

const SAVED_STEP = 0;
const SUNDAY_TICKET_STEP = 1;
const YOUTUBE_TV_STEP = 2;
const NETWORK_APP_STEP = 3;
const PAY_TV_STEP = 4;

/** Linear networks YouTube TV carries. A Prime-only game is not one of these. */
const YOUTUBE_TV_NETWORKS = new Set<AiringNetwork>([
  'cbs',
  'fox',
  'nbc',
  'abc',
  'espn',
  'nfl_network',
]);

const PAY_TV_SERVICES = [
  'directv',
  'hulu_live',
  'fubo',
  'cable_other',
] as const satisfies readonly ResolverService[];

const PAY_TV_LINKS: Partial<Record<AiringNetwork, readonly DestinationTemplate[]>> = {
  abc: [DESTINATION_TABLE.abc],
  cbs: [DESTINATION_TABLE.cbs],
  nbc: [DESTINATION_TABLE.nbc],
  fox: [DESTINATION_TABLE.foxSearch, DESTINATION_TABLE.foxChannels],
  espn: [DESTINATION_TABLE.espn],
};

interface Candidate extends WatchDestination {
  step: number;
}

function materialize(template: DestinationTemplate, away: string, home: string): string | null {
  if (!('query' in template)) return template.url;
  if (away.length === 0 || home.length === 0) return null;
  const phrase = template.query.replaceAll('{away}', away).replaceAll('{home}', home);
  return `${template.base}${encodeURIComponent(phrase)}`;
}

function addTemplate(
  out: Candidate[],
  step: number,
  template: DestinationTemplate,
  game: DestinationGame,
): void {
  const url = materialize(template, game.awayNickname, game.homeNickname);
  if (url === null) return;
  out.push({ url, verified: template.verified, note: template.note, step });
}

function addServiceUrl(
  out: Candidate[],
  step: number,
  service: 'youtube_tv' | 'sunday_ticket' | 'amazon_prime',
  network: AiringNetwork,
  game: DestinationGame,
  verified: boolean,
  note: string,
): void {
  const url = serviceWatchUrl({
    service,
    awayNickname: game.awayNickname,
    homeNickname: game.homeNickname,
    kickoff: game.kickoff,
    network,
  });
  if (url.length === 0) return;
  out.push({ url, verified, note, step });
}

function rankDestinations(candidates: readonly Candidate[]): WatchDestination[] {
  const saved = candidates.filter((candidate) => candidate.step === SAVED_STEP);
  const generated = candidates.filter((candidate) => candidate.step !== SAVED_STEP);
  generated.sort((a, b) => {
    if (a.verified !== b.verified) return a.verified ? -1 : 1;
    return a.step - b.step;
  });

  const seen = new Set<string>();
  const unique: WatchDestination[] = [];
  for (const candidate of [...saved, ...generated]) {
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    unique.push({ url: candidate.url, verified: candidate.verified, note: candidate.note });
  }
  return unique;
}

function toResolution(ranked: readonly WatchDestination[]): DestinationResolution {
  const primary = ranked[0];
  if (primary === undefined) return { kind: 'unavailable', reason: 'not_on_your_services' };
  return { kind: 'destinations', primary, alternates: ranked.slice(1) };
}

/**
 * Ordered watch links for one game and one user's services.
 * A saved link is first. Among generated links, `verified: true` outranks
 * `verified: false`, then earlier steps win. No subscribed services and no
 * saved link keeps today's path (`legacy`). Airings `mapMediaName` does not
 * know, and nothing else to open, are `unknown_network` — the card says
 * "On {raw}" and does not link. No airing rows at all are not "unavailable":
 * a YouTube TV user still gets the nickname search, and everyone else is
 * `no_broadcast_info` ("Broadcast TBD", no link).
 */
export function resolveDestinations(
  game: DestinationGame,
  services: readonly ResolverService[],
): DestinationResolution {
  const subscribed = new Set<string>(services);
  const saved = game.savedUrl?.trim() ?? '';
  const mapped: AiringNetwork[] = [];
  const unmapped: string[] = [];

  for (const airing of game.airings) {
    const network = mapMediaName(airing.rawName);
    if (network === null) {
      unmapped.push(airing.rawName);
      continue;
    }
    if (!mapped.includes(network)) mapped.push(network);
  }

  const raw = unmapped[0];
  if (mapped.length === 0 && raw !== undefined && saved.length === 0) {
    return { kind: 'unknown_network', raw };
  }
  if (mapped.length === 0 && unmapped.length === 0) {
    return noAiringResolution(game, subscribed, saved);
  }
  if (saved.length === 0 && subscribed.size === 0) return { kind: 'legacy' };

  const candidates: Candidate[] = [];
  if (saved.length > 0) {
    candidates.push({
      url: saved,
      verified: true,
      note: 'Saved stream link',
      step: SAVED_STEP,
    });
  }

  const ticketNetwork = mapped.find((network) => network === 'cbs' || network === 'fox');
  if (game.outOfMarketSunday && ticketNetwork !== undefined && subscribed.has('sunday_ticket')) {
    addServiceUrl(
      candidates,
      SUNDAY_TICKET_STEP,
      'sunday_ticket',
      ticketNetwork,
      game,
      true,
      'Sunday Ticket search',
    );
  }

  const linear = mapped.find((network) => YOUTUBE_TV_NETWORKS.has(network));
  if (linear !== undefined && subscribed.has('youtube_tv')) {
    addServiceUrl(
      candidates,
      YOUTUBE_TV_STEP,
      'youtube_tv',
      linear,
      game,
      true,
      'YouTube TV search',
    );
  }

  if (mapped.includes('amazon_prime') && subscribed.has('amazon_prime')) {
    addServiceUrl(
      candidates,
      NETWORK_APP_STEP,
      'amazon_prime',
      'amazon_prime',
      game,
      true,
      'Current Prime link',
    );
  }
  if (mapped.includes('cbs') && subscribed.has('paramount_plus')) {
    addTemplate(candidates, NETWORK_APP_STEP, DESTINATION_TABLE.paramountPlus, game);
  }
  if (mapped.includes('nbc') && subscribed.has('peacock')) {
    addTemplate(candidates, NETWORK_APP_STEP, DESTINATION_TABLE.peacock, game);
  }
  if (mapped.includes('espn') && subscribed.has('espn')) {
    addTemplate(candidates, NETWORK_APP_STEP, DESTINATION_TABLE.espn, game);
  }
  if (mapped.includes('fox') && subscribed.has('fox_one')) {
    addTemplate(candidates, NETWORK_APP_STEP, DESTINATION_TABLE.foxSearch, game);
    addTemplate(candidates, NETWORK_APP_STEP, DESTINATION_TABLE.foxChannels, game);
  }

  const payTv = PAY_TV_SERVICES.some((service) => subscribed.has(service));
  if (payTv) {
    for (const network of mapped) {
      const links = PAY_TV_LINKS[network];
      if (links === undefined) continue;
      for (const link of links) addTemplate(candidates, PAY_TV_STEP, link, game);
    }
  }

  return toResolution(rankDestinations(candidates));
}

/**
 * Nothing was ingested for this game. YouTube TV search only needs nicknames.
 * The network argument is unused by that URL. Anyone else gets no link.
 */
function noAiringResolution(
  game: DestinationGame,
  subscribed: ReadonlySet<string>,
  saved: string,
): DestinationResolution {
  const candidates: Candidate[] = [];
  if (saved.length > 0) {
    candidates.push({
      url: saved,
      verified: true,
      note: 'Saved stream link',
      step: SAVED_STEP,
    });
  }
  if (
    subscribed.has('youtube_tv') &&
    game.awayNickname.length > 0 &&
    game.homeNickname.length > 0
  ) {
    addServiceUrl(
      candidates,
      YOUTUBE_TV_STEP,
      'youtube_tv',
      'nbc',
      game,
      true,
      'YouTube TV search',
    );
  }
  if (candidates.length === 0) return { kind: 'no_broadcast_info' };
  return toResolution(rankDestinations(candidates));
}

/**
 * ESPN media names already stored on `game_airings`. A name `mapMediaName` accepts is used
 * as-is. A name it rejects falls back to the canonical string for that network column, so a
 * fixture like `AMAZON_PRIME` still resolves. An unmapped name with no canonical string
 * stays raw (`unknown_network`).
 */
const STORED_NETWORK_RAW: Partial<Record<AiringNetwork, string>> = {
  cbs: 'CBS',
  fox: 'FOX',
  nbc: 'NBC',
  abc: 'ABC',
  espn: 'ESPN',
  amazon_prime: 'Prime Video',
  nfl_network: 'NFL Net',
};

const USER_SERVICE_SET = new Set<string>(USER_SERVICES);

function storedRawName(airing: { network: string; espnMediaName: string }): string | null {
  const media = airing.espnMediaName.trim();
  if (media.length > 0 && mapMediaName(media) !== null) return media;
  const canonical = STORED_NETWORK_RAW[airing.network as AiringNetwork];
  if (canonical !== undefined) return canonical;
  return media.length > 0 ? media : null;
}

/** `resolveDestinations` for rows already stored as network + ESPN media name. */
export function resolveStoredDestination(input: {
  awayNickname: string;
  homeNickname: string;
  kickoff: Date | null;
  airings: readonly { network: string; espnMediaName: string }[];
  services: readonly string[];
  savedUrl: string | null;
  outOfMarketSunday: boolean;
}): DestinationResolution {
  const airings: { rawName: string }[] = [];
  for (const airing of input.airings) {
    const rawName = storedRawName(airing);
    if (rawName !== null) airings.push({ rawName });
  }
  const services = input.services.filter((service): service is UserService =>
    USER_SERVICE_SET.has(service),
  );
  return resolveDestinations(
    {
      awayNickname: input.awayNickname,
      homeNickname: input.homeNickname,
      kickoff: input.kickoff,
      airings,
      savedUrl: input.savedUrl,
      outOfMarketSunday: input.outOfMarketSunday,
    },
    services,
  );
}
