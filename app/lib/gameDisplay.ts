import {
  networkLabelFromAirings,
  type AiringMarket,
  type DestinationResolution,
  type MarketConfidence,
  type RouteHint,
  type WatchDestination,
} from '@pivot/shared/broadcast';
import type { FlaggedPlayer, GameSummary } from './flagEventPayload';

/** `GET /flags/current` flag entry (Section 9). `game` reuses the shared `GameSummary` wire shape.
 *  Sprint 9 Phase 1 replaced `flagged_player_ids: string[]` with the full `flagged_players` objects
 *  (same shape the `flag_event` WebSocket/push payload already carried), so the client renders the
 *  same objects from either channel. */
export interface CurrentFlag {
  game_id: string;
  priority_score: number;
  reasons: string[];
  flagged_players: FlaggedPlayer[];
  game: GameSummary;
  recommended_action: 'switch_primary' | 'add_to_split' | 'notify_only';
  /** Outcome-free chip for an opponent red-zone row. Absent on the user's own flags. */
  opponent_label?: string;
  /** True bets on this game. Absent when the user has no bet on it. */
  bets?: { stake_id: string; label: string }[];
}

/** Opponent red-zone row from `GET /flags/current`. Absent on the wire when `watchOpponent` is off. */
export interface OpponentFlagWire {
  game_id: string;
  priority_score: number;
  player_ids: string[];
  reasons: string[];
  players?: { player_id: string; first_name: string; last_name: string }[];
}

export interface FlagsCurrentResponse {
  flags: CurrentFlag[];
  generated_at: string;
  /**
   * Present only when at least one game in the body is in progress.
   * `false` means the runner heartbeat is missing or older than 45s.
   */
  live_feed_ok?: boolean;
  opponent_flags?: OpponentFlagWire[];
  opponent_game_ids?: string[];
  /** Every game with a bet stake this week. Absent when the user has none. */
  bet_game_ids?: string[];
}

/** One watch option from `GET /games/:id/broadcasts` / `GET /games?week=` (Section 9): a service
 *  the user has, carrying one of the game's airings. */
export interface GameBroadcast {
  service: string;
  deep_link_url: string;
  requires_subscription: boolean;
  user_has_subscription: boolean;
  typical_lag_seconds: number;
  preferred: boolean;
  network: string;
  market_confidence: MarketConfidence;
  route_hint?: RouteHint;
  /** Resolver note, used as the button label when this option is not a ranked service row. */
  label?: string;
}

/** One airing of a game (`GET /games?week=` `airings`) — who is broadcasting it. */
export interface GameAiring {
  network: string;
  market: AiringMarket;
  market_confidence: MarketConfidence;
}

export interface GameBroadcastsResponse {
  game_id: string;
  broadcasts: GameBroadcast[];
  destination?: DestinationResolution;
}

/** Human labels for airing networks and user services (docs/B1-BROADCAST-DESIGN.md §1.3–1.4) —
 *  drives the Section 10 CTA copy (`Watch on {preferred service}`). Unknown services fall back to
 *  the raw value. */
const SERVICE_LABELS: Record<string, string> = {
  youtube_tv: 'YouTube TV',
  sunday_ticket: 'NFL Sunday Ticket',
  hulu_live: 'Hulu + Live TV',
  fubo: 'Fubo',
  directv: 'DIRECTV',
  sling: 'Sling TV',
  espn: 'ESPN',
  espn_plus: 'ESPN+',
  fox_one: 'FOX One',
  cable_other: 'Other cable',
  paramount_plus: 'Paramount+',
  peacock: 'Peacock',
  amazon_prime: 'Prime Video',
  nfl_plus: 'NFL+',
  nfl_network: 'NFL Network',
  netflix: 'Netflix',
  fox: 'FOX',
  cbs: 'CBS',
  nbc: 'NBC',
  abc: 'ABC',
};

export function serviceLabel(service: string): string {
  return SERVICE_LABELS[service] ?? service;
}

/** Short labels for `FlagReasonType` (Section 8) — the fallback chip copy for a reason with no
 *  resolvable flagged player (shouldn't normally happen; see `reasonChipCopy` in `teamDisplay.ts`
 *  for the Section 10 "Jonathan Taylor active — RB — Colts offense" fidelity chip, which Sprint 9
 *  Phase 1/2 made possible via `flagged_players`). */
const REASON_LABELS: Record<string, string> = {
  offense_active: 'Your offense is on the field',
  defense_active: 'Your defense is on the field',
  red_zone: 'In the red zone',
  close_game: 'Close game, late',
  star_player_active: 'Star player active',
};

export function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

/** `time_remaining_sec` -> `M:SS` clock. */
export function formatClock(timeRemainingSec: number): string {
  const total = Math.max(0, Math.floor(timeRemainingSec));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Quarter label — 1-4, then OT for quarter 5 (Section 8: quarter 5 = OT). */
export function quarterLabel(quarter: number): string {
  return quarter >= 5 ? 'OT' : `Q${quarter}`;
}

/**
 * Halftime and end-of-quarter, from the fields `game_state` actually stores.
 *
 * There is no period-status field. ESPN's end of Q2 is play type 65 (`end_half`): quarter 2,
 * clock 0, possession cleared. That is HALFTIME. An `end_period` play (end of Q1 or Q3, and Q2
 * only before the half clears the ball) keeps possession and a 0:00 clock, which is `END Qn`.
 * Pass `possessionTeam` when the caller has it. Omit it and quarter 2 at 0:00 stays HALFTIME.
 * Overtime is not a break label — callers keep the `OT` clock.
 */
export function periodBreakLabel(
  quarter: number,
  timeRemainingSec: number | null,
  possessionTeam?: string | null,
): string | null {
  if (!Number.isFinite(quarter) || quarter < 1 || quarter > 4) return null;
  if (timeRemainingSec === null || !Number.isFinite(timeRemainingSec) || timeRemainingSec > 0) {
    return null;
  }
  if (quarter === 2 && (possessionTeam === undefined || possessionTeam === null)) {
    return 'HALFTIME';
  }
  if (quarter === 1 || quarter === 2 || quarter === 3) {
    return `END Q${quarter}`;
  }
  return null;
}

/**
 * Live board clock, e.g. `"Q3 2:36"`, `"OT 7:12"`, `"HALFTIME"`, `"END Q1"`.
 * No quarter yet → `"LIVE"`; no clock → the quarter alone.
 */
export function liveClockLabel(
  quarter: number,
  timeRemainingSec: number | null,
  possessionTeam?: string | null,
): string {
  const period = periodBreakLabel(quarter, timeRemainingSec, possessionTeam);
  if (period) return period;
  if (!Number.isFinite(quarter) || quarter < 1) return 'LIVE';
  if (timeRemainingSec === null || !Number.isFinite(timeRemainingSec)) {
    return quarterLabel(quarter);
  }
  return `${quarterLabel(quarter)} ${formatClock(timeRemainingSec)}`;
}

/** Compact live score in matchup order (away first), e.g. `"10–21"`. */
export function compactScoreLabel(score: { away: number; home: number }): string {
  return `${score.away}–${score.home}`;
}

const DOWN_ORDINALS: Record<number, string> = {
  1: '1st',
  2: '2nd',
  3: '3rd',
  4: '4th',
};

/** Broadcast-style down-and-distance, e.g. `"1st & 10"`. Null when either input is missing. */
export function downDistanceLabel(down: number | null, distance: number | null): string | null {
  if (down === null || distance === null) return null;
  const ordinal = DOWN_ORDINALS[down];
  if (!ordinal) return null;
  return `${ordinal} & ${distance}`;
}

/**
 * Broadcast-style field position, e.g. `"IND 32"`.
 * `yardsToEndzone > 50` → own territory (`100 - yards`, possessing abbr);
 * otherwise opponent territory (`yards`, opponent abbr). Null when yardline or possession is missing.
 */
export function fieldPositionLabel(
  yardsToEndzone: number | null,
  possessionAbbr: string | null,
  opponentAbbr: string | null,
): string | null {
  if (yardsToEndzone === null || possessionAbbr === null) return null;
  if (yardsToEndzone > 50) {
    return `${possessionAbbr} ${100 - yardsToEndzone}`;
  }
  if (opponentAbbr === null) return null;
  return `${opponentAbbr} ${yardsToEndzone}`;
}

/** Marker position as % from the possessing team's own goal (0) toward opponent end zone (100). */
export function fieldGaugeMarkerPercent(yardsToEndzone: number): number {
  return Math.max(0, Math.min(100, 100 - yardsToEndzone));
}

/** Yard-line numbers painted on the 100-yard stick (`10 20 30 40 50 40 30 20 10`). */
export const FIELD_GAUGE_TICK_LABELS = [10, 20, 30, 40, 50, 40, 30, 20, 10] as const;

/**
 * Unlabeled 5-yard hash marks between each major tick (`5 15 … 95`), as % from the possessing
 * team's own goal — same coordinate space as `fieldGaugeTickPercent` / `fieldGaugeMarkerPercent`.
 */
export const FIELD_GAUGE_MINOR_TICK_PERCENTS = [5, 15, 25, 35, 45, 55, 65, 75, 85, 95] as const;

/** Right-edge width of the always-on red-zone geography (opponent's 20-yard area). */
export const FIELD_GAUGE_RED_ZONE_PERCENT = 20;

/** Tick position as % from the possessing team's own goal; index 0 → 10-yard line. */
export function fieldGaugeTickPercent(tickIndex: number): number {
  return (tickIndex + 1) * 10;
}

/** True when the ball is inside the opponent's 20 — does not gate painting the red-zone geography. */
export function fieldGaugeShowsRedZone(yardsToEndzone: number): boolean {
  return yardsToEndzone <= 20;
}

/** Uppercase nicknames for the Now Active matchup line (`COLTS @ TITANS`). */
export function matchupNicknameLabel(awayName: string, homeName: string): string {
  return `${awayName.toUpperCase()} @ ${homeName.toUpperCase()}`;
}

export interface FieldAlignedMatchup {
  leftName: string;
  rightName: string;
  leftScore: number;
  rightScore: number;
  /** `teams.primary_color` for the left side (empty string when the catalog has none). */
  leftPrimaryColor: string;
  rightPrimaryColor: string;
}

/**
 * Now Active scoreboard oriented like the field gauge: possessing team on the left (own goal),
 * opponent on the right (the end zone being attacked). Scores sit with their team.
 * When nobody has the ball, falls back to away-left / home-right (traditional "@" reading).
 */
export function fieldAlignedMatchup(game: {
  possession_team: string | null;
  home_team: string;
  away_team: string;
  home_team_name: string;
  away_team_name: string;
  home_team_primary_color: string;
  away_team_primary_color: string;
  score: { home: number; away: number };
}): FieldAlignedMatchup {
  const homeName = game.home_team_name.toUpperCase();
  const awayName = game.away_team_name.toUpperCase();

  if (game.possession_team === game.home_team) {
    return {
      leftName: homeName,
      rightName: awayName,
      leftScore: game.score.home,
      rightScore: game.score.away,
      leftPrimaryColor: game.home_team_primary_color,
      rightPrimaryColor: game.away_team_primary_color,
    };
  }
  if (game.possession_team === game.away_team) {
    return {
      leftName: awayName,
      rightName: homeName,
      leftScore: game.score.away,
      rightScore: game.score.home,
      leftPrimaryColor: game.away_team_primary_color,
      rightPrimaryColor: game.home_team_primary_color,
    };
  }
  return {
    leftName: awayName,
    rightName: homeName,
    leftScore: game.score.away,
    rightScore: game.score.home,
    leftPrimaryColor: game.away_team_primary_color,
    rightPrimaryColor: game.home_team_primary_color,
  };
}

/**
 * `#RRGGBB` / `#RGB` → `rgba(r,g,b,a)`. Returns null when the hex is empty or unparseable so
 * callers can fall back to a neutral wash instead of inventing a color.
 */
export function hexWithAlpha(hex: string, alpha: number): string | null {
  const raw = hex.trim().replace(/^#/, '');
  const full = raw.length === 3 ? raw.replace(/./g, (c) => c + c) : raw;
  if (full.length !== 6) return null;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Abbreviation of the team opposite possession, or null when nobody has the ball. */
export function opponentAbbreviation(
  possessionTeam: string | null,
  homeTeam: string,
  awayTeam: string,
): string | null {
  if (possessionTeam === null) return null;
  return possessionTeam === homeTeam ? awayTeam : homeTeam;
}

/**
 * Clock ticker, appending down/distance when both are present (`Q2 · 7:14 · 1st & 10`).
 * A period break replaces the line (`HALFTIME`, `END Q1`) so it matches `liveClockLabel`.
 */
export function gameClockLine(
  quarter: number,
  timeRemainingSec: number,
  down: number | null,
  distance: number | null,
  possessionTeam?: string | null,
): string {
  const period = periodBreakLabel(quarter, timeRemainingSec, possessionTeam);
  if (period) return period;
  const clock = `${quarterLabel(quarter)} · ${formatClock(timeRemainingSec)}`;
  const downDistance = downDistanceLabel(down, distance);
  return downDistance ? `${clock} · ${downDistance}` : clock;
}

/**
 * Also-flagged situation column. Clock always; field position and down/distance omitted when
 * null (kickoff / timeout / between plays).
 */
export function alsoFlaggedSituationLines(game: GameSummary): string[] {
  const lines = [gameClockLine(game.quarter, game.time_remaining_sec, null, null)];
  const position = fieldPositionLabel(
    game.yards_to_endzone,
    game.possession_team,
    opponentAbbreviation(game.possession_team, game.home_team, game.away_team),
  );
  if (position) lines.push(position);
  const downDistance = downDistanceLabel(game.down, game.distance);
  if (downDistance) lines.push(downDistance);
  return lines;
}

/** The `preferred` broadcast (the switch target), or the first available, or null. */
export function pickPreferredBroadcast(broadcasts: readonly GameBroadcast[]): GameBroadcast | null {
  return broadcasts.find((b) => b.preferred) ?? broadcasts[0] ?? null;
}

/** The local-channel option ranked second behind Sunday Ticket (docs/B1-BROADCAST-DESIGN.md §4.4). */
export function localRouteOption(broadcasts: readonly GameBroadcast[]): GameBroadcast | null {
  return broadcasts.find((b) => b.route_hint === 'in_market_local') ?? null;
}

export interface WatchOptionParts {
  title: string;
  /** When to use the option; only the in-market local route has one (§4.4). */
  caption: string | null;
}

export function watchOptionParts(broadcast: GameBroadcast): WatchOptionParts {
  const service = serviceLabel(broadcast.service);
  return broadcast.route_hint === 'in_market_local'
    ? {
        title: `${serviceLabel(broadcast.network)} on ${service}`,
        caption: 'If this game is in your market',
      }
    : { title: service, caption: null };
}

/** An option's name on one line, for lists: `watchOptionParts` joined with a dash. */
export function watchOptionLabel(broadcast: GameBroadcast): string {
  const { title, caption } = watchOptionParts(broadcast);
  return caption === null
    ? title
    : `${title} — ${caption.charAt(0).toLowerCase()}${caption.slice(1)}`;
}

export type WatchCta =
  | { kind: 'watch'; broadcast: GameBroadcast; alternates?: GameBroadcast[] }
  | { kind: 'airing'; text: string }
  | { kind: 'none' };

function broadcastForDestination(
  destination: WatchDestination,
  broadcasts: readonly GameBroadcast[],
  preferred: boolean,
): GameBroadcast {
  const existing = broadcasts.find((broadcast) => broadcast.deep_link_url === destination.url);
  if (existing) return existing;
  const fallback = pickPreferredBroadcast(broadcasts);
  return {
    service: fallback?.service ?? '',
    deep_link_url: destination.url,
    requires_subscription: true,
    user_has_subscription: true,
    typical_lag_seconds: fallback?.typical_lag_seconds ?? 0,
    preferred,
    network: fallback?.network ?? '',
    market_confidence: fallback?.market_confidence ?? 'national',
    label: destination.note,
  };
}

/**
 * What goes where a card's Switch/Watch button sits (docs/B1-BROADCAST-DESIGN.md §1.7).
 * A resolver result replaces the ranked option: the primary link, later links as alternates,
 * "Not on your services" when nothing matches, "On {raw}" with no link for an unmapped
 * airing, and "Broadcast TBD" when the game has no airing rows. `legacy` (or no destination) keeps today's preferred option, or the airing as plain
 * text ("On FOX").
 */
export function watchCta(
  broadcasts: readonly GameBroadcast[],
  airings: readonly { network: string }[],
  destination?: DestinationResolution,
): WatchCta {
  if (destination && destination.kind !== 'legacy') {
    if (destination.kind === 'unavailable') {
      return { kind: 'airing', text: 'Not on your services' };
    }
    if (destination.kind === 'unknown_network') {
      return { kind: 'airing', text: `On ${destination.raw}` };
    }
    if (destination.kind === 'no_broadcast_info') {
      return { kind: 'airing', text: 'Broadcast TBD' };
    }
    const primary = broadcastForDestination(destination.primary, broadcasts, true);
    const alternates = destination.alternates.map((alternate) =>
      broadcastForDestination(alternate, broadcasts, false),
    );
    return alternates.length > 0
      ? { kind: 'watch', broadcast: primary, alternates }
      : { kind: 'watch', broadcast: primary };
  }
  const preferred = pickPreferredBroadcast(broadcasts);
  if (preferred && preferred.deep_link_url.length > 0) {
    return { kind: 'watch', broadcast: preferred };
  }
  const network = networkLabelFromAirings(airings);
  return network === null ? { kind: 'none' } : { kind: 'airing', text: `On ${network}` };
}

/** A Switch/Watch button exists only when there is a link to open. */
export function showsWatchButton(cta: WatchCta | null): boolean {
  return cta?.kind === 'watch';
}

/** Button text for a watch option. A resolver note wins over "Watch on {service}". */
export function watchBroadcastLabel(broadcast: GameBroadcast): string {
  return broadcast.label ?? `Watch on ${serviceLabel(broadcast.service)}`;
}
