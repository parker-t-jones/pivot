import type { GameSummary } from './flagEventPayload';

/** `GET /flags/current` flag entry (Section 9). `game` reuses the shared `GameSummary` wire shape. */
export interface CurrentFlag {
  game_id: string;
  priority_score: number;
  reasons: string[];
  flagged_player_ids: string[];
  game: GameSummary;
  recommended_action: 'switch_primary' | 'add_to_split' | 'notify_only';
}

export interface FlagsCurrentResponse {
  flags: CurrentFlag[];
  generated_at: string;
}

/** One entry of the `GET /games/:id/broadcasts` response (Section 9). */
export interface GameBroadcast {
  service: string;
  deep_link_url: string;
  requires_subscription: boolean;
  user_has_subscription: boolean;
  typical_lag_seconds: number;
  preferred: boolean;
}

export interface GameBroadcastsResponse {
  game_id: string;
  broadcasts: GameBroadcast[];
}

/** Human labels for `game_broadcasts.service` (Section 7 enum) — drives the Section 10 CTA copy
 *  ("Watch on Sunday Ticket"). Unknown services fall back to the raw value. */
const SERVICE_LABELS: Record<string, string> = {
  sunday_ticket: 'Sunday Ticket',
  espn_plus: 'ESPN+',
  paramount_plus: 'Paramount+',
  peacock: 'Peacock',
  amazon_prime: 'Prime Video',
  nfl_plus: 'NFL+',
  nfl_network: 'NFL Network',
  fox: 'FOX',
  cbs: 'CBS',
  nbc: 'NBC',
  abc: 'ABC',
};

export function serviceLabel(service: string): string {
  return SERVICE_LABELS[service] ?? service;
}

/** Short labels for `FlagReasonType` (Section 8). `/flags/current` only carries reason *types*, not
 *  player names, so the Section 10 chip ("Jonathan Taylor active — RB — Colts offense") can't be
 *  reproduced from this endpoint alone (see report). */
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

/** The `preferred` broadcast (the switch target), or the first available, or null. */
export function pickPreferredBroadcast(broadcasts: GameBroadcast[]): GameBroadcast | null {
  return broadcasts.find((b) => b.preferred) ?? broadcasts[0] ?? null;
}
