/**
 * Sprint 6 Phase 6 — the client's own mirror of `FlagEventEnvelope['payload']`
 * (`services/dispatcher/src/delivery.ts`). This is deliberately a hand-copied structural type, not an
 * import from `@pivot/dispatcher`: the client never receives a `FlagEventEnvelope` TypeScript
 * value, only its JSON-serialized `payload` (Phase 3's invariant — push `data` is set to
 * `envelope.payload` verbatim, and the not-yet-built WebSocket client will receive the same shape).
 * A mobile client should describe the wire format it actually parses, not reach into a backend
 * package's internal implementation type it will never run against at runtime.
 *
 * Keep this in sync with `FlagEventEnvelope['payload']` by hand — a real drift-detection mechanism
 * (e.g. a shared `@pivot/wire-types` package) is future work, not this phase's scope.
 */

export interface FlagReason {
  type: 'offense_active' | 'defense_active' | 'red_zone' | 'close_game' | 'star_player_active';
  triggeringPlayerIds: string[];
}

export interface FlagState {
  gameId: string;
  flagged: boolean;
  priorityScore: number;
  reasons: FlagReason[];
  computedAt: number;
}

export interface GameSummary {
  home_team: string;
  away_team: string;
  home_team_name: string;
  away_team_name: string;
  /** Sprint 9 Phase 1 addition — `teams.primary_color`/`secondary_color` (Section 7), hex strings.
   *  Drives the Section 10 "team color flash" on the switching transition. */
  home_team_primary_color: string;
  home_team_secondary_color: string;
  away_team_primary_color: string;
  away_team_secondary_color: string;
  score: { home: number; away: number };
  quarter: number;
  time_remaining_sec: number;
  /** Possessing team abbreviation, or null when nobody has the ball. */
  possession_team: string | null;
  /** Yards from the possessing team to the opponent end zone; null when not applicable. */
  yards_to_endzone: number | null;
  /** Current down (1–4), or null when not a scrimmage situation. */
  down: number | null;
  /** Yards to go for a first down, or null when not a scrimmage situation. */
  distance: number | null;
  /** Whether the ball is inside the opponent's 20. */
  in_red_zone: boolean;
}

export interface FlaggedPlayer {
  player_id: string;
  first_name: string;
  last_name: string;
  position: string;
}

export interface FlagEventAction {
  /** Widened to `string` on the wire too (`delivery.ts`'s own envelope type does the same) — the
   *  real values are `Action['type']` from `services/dispatcher/src/types.ts`
   *  (`'notify_only' | 'in_app_indicator' | 'auto_switch' | 'prompt' | 'prompt_low_priority'`), but
   *  this module doesn't import dispatcher-internal types (see file header). */
  type: string;
  cta: string | null;
  recommended_source: string | null;
  deep_link_url: string | null;
}

export interface FlagEventPayload {
  /** Sprint 6 Phase 7 addition — the underlying `flag_events.id`, the value `POST /flags/:event_id/action`
   *  expects in its URL. Added to `FlagEventEnvelope['payload']` in `delivery.ts` at the same time as
   *  this field landed here (was a discovered gap in Phase 6: it lives on the envelope's own `id`,
   *  not in `payload`, which is all a push's `data` ever carries). */
  event_id: string;
  user_id: string;
  game_id: string;
  event_type: 'flag_added' | 'flag_removed' | 'priority_increased' | 'priority_decreased';
  /**
   * Sprint 9 Phase 1 addition — the abbreviation of whichever team currently has the ball, or
   * `null` with no possession (special teams / between plays / kickoff). `old_state.possession_team`
   * is UNCONDITIONALLY `null` on the wire, by deliberate server-side ruling (see `delivery.ts`):
   * it is never a delivery-time snapshot of "possession before," because populating both
   * `old_state` and `new_state` from the same current read would make them always agree, silently
   * encoding a lie about the field's meaning. Render `old_state?.possession_team` as "unknown," not
   * as a real historical value.
   */
  old_state: (FlagState & { possession_team: string | null }) | null;
  new_state: FlagState & { possession_team: string | null };
  action: FlagEventAction;
  game_summary: GameSummary;
  flagged_players: FlaggedPlayer[];
}

/**
 * Narrow guard for the `data` object `expo-notifications` hands back on a received notification
 * (typed `Record<string, unknown> | undefined` by the SDK — it crossed a JSON boundary, so nothing
 * about its shape is guaranteed at compile time). Checks just enough fields to be confident this is
 * a `FlagEventPayload` and not some other notification's data, without re-deriving a full schema.
 */
export function isFlagEventPayload(data: unknown): data is FlagEventPayload {
  if (typeof data !== 'object' || data === null) return false;
  const candidate = data as Record<string, unknown>;
  return (
    typeof candidate.event_id === 'string' &&
    typeof candidate.user_id === 'string' &&
    typeof candidate.game_id === 'string' &&
    typeof candidate.event_type === 'string' &&
    typeof candidate.game_summary === 'object' &&
    candidate.game_summary !== null
  );
}
