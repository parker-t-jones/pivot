import {
  networkLabelFromAirings,
  type AiringMarket,
  type MarketConfidence,
  type RouteHint,
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
}

export interface FlagsCurrentResponse {
  flags: CurrentFlag[];
  generated_at: string;
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
  espn_plus: 'ESPN+',
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
  espn: 'ESPN',
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

/** Clock ticker, appending down/distance when both are present (`Q2 · 7:14 · 1st & 10`). */
export function gameClockLine(
  quarter: number,
  timeRemainingSec: number,
  down: number | null,
  distance: number | null,
): string {
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
  | { kind: 'watch'; broadcast: GameBroadcast }
  | { kind: 'airing'; text: string }
  | { kind: 'none' };

/**
 * What goes where a card's Switch/Watch button sits (docs/B1-BROADCAST-DESIGN.md §1.7): the
 * preferred option when the user has one that opens, otherwise the airing as plain text
 * ("On FOX") — never a disabled button.
 */
export function watchCta(
  broadcasts: readonly GameBroadcast[],
  airings: readonly { network: string }[],
): WatchCta {
  const preferred = pickPreferredBroadcast(broadcasts);
  if (preferred && preferred.deep_link_url.length > 0) {
    return { kind: 'watch', broadcast: preferred };
  }
  const network = networkLabelFromAirings(airings);
  return network === null ? { kind: 'none' } : { kind: 'airing', text: `On ${network}` };
}
