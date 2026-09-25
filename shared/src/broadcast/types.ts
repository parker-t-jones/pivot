/**
 * Broadcast airing / user-service catalogs (docs/B1-BROADCAST-DESIGN.md §1.3–1.5).
 * New types for B1.1 — do not replace app `StreamingService` until B1.3.
 */

/** Keys that may appear on a game airing. Not picker values. */
export const AIRING_NETWORKS = [
  'cbs',
  'fox',
  'nbc',
  'abc',
  'espn',
  'amazon_prime',
  'peacock',
  'nfl_network',
  'netflix',
  'espn_plus',
  'nfl_plus',
  'paramount_plus',
] as const;

export type AiringNetwork = (typeof AIRING_NETWORKS)[number];

/** Keys that may appear on user_app_presence after B1.3. Picker values. */
export const USER_SERVICES = [
  'youtube_tv',
  'sunday_ticket',
  'hulu_live',
  'fubo',
  'directv',
  'sling',
  'amazon_prime',
  'peacock',
  'paramount_plus',
  'espn_plus',
  'nfl_plus',
] as const;

export type UserService = (typeof USER_SERVICES)[number];

export type AiringMarket = 'national' | 'regional' | 'unknown';

export type MarketRule = 'any' | 'in_market' | 'out_of_market';

export type MarketConfidence = 'national' | 'unknown' | 'in' | 'out';

export type RouteHint = 'in_market_local';

/** Broadcast windows — same labels as `app/lib/board.ts` `WindowLabel`. */
export type WindowLabel =
  | 'THURSDAY NIGHT'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY'
  | 'SUNDAY · MORNING'
  | 'SUNDAY · EARLY'
  | 'SUNDAY · LATE'
  | 'PRIMETIME'
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY';

export interface ParsedAiring {
  network: AiringNetwork;
  market: AiringMarket;
  espnMediaName: string;
  espnType: string | null;
}

export interface CarriageEntry {
  service: UserService;
  networks: readonly AiringNetwork[];
  /** Omit = all windows. */
  windows?: readonly WindowLabel[];
  marketRule: MarketRule;
  requiresSubscription: true;
  /** Expansion uses only confirmed entries. */
  confirmed: boolean;
}

export interface CarriageMapVersion {
  version: string;
  effectiveFrom: string;
  entries: readonly CarriageEntry[];
}

export interface WatchOption {
  service: UserService;
  network: AiringNetwork;
  requiresSubscription: true;
  marketConfidence: MarketConfidence;
  routeHint?: RouteHint;
  typicalLagSeconds: number;
  preferred: boolean;
}

/** Minimal ESPN event shape parseEspnAirings reads. */
export interface EspnBroadcastEvent {
  id: string;
  shortName?: string;
  date?: string;
  competitions?: Array<{
    broadcast?: string;
    broadcasts?: Array<{ market?: string; names?: string[] }>;
    geoBroadcasts?: Array<{
      type?: { shortName?: string };
      market?: { type?: string };
      media?: { shortName?: string };
    }>;
  }>;
}

export type UnmappedMediaLog = (info: {
  eventId: string;
  shortName: string | undefined;
  rawName: string;
  source: 'geoBroadcasts' | 'broadcasts';
}) => void;

/** One game in a week slate for regional-slate detection. */
export interface SlateGame {
  id: string;
  kickoff: Date;
  networks: readonly AiringNetwork[];
}
