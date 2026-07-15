/**
 * Sprint 6 Phase 6 — the client's own mirror of `FlagEventEnvelope['payload']`
 * (`services/dispatcher/src/delivery.ts`). This is deliberately a hand-copied structural type, not an
 * import from `@fantasy-focus/dispatcher`: the client never receives a `FlagEventEnvelope` TypeScript
 * value, only its JSON-serialized `payload` (Phase 3's invariant — push `data` is set to
 * `envelope.payload` verbatim, and the not-yet-built WebSocket client will receive the same shape).
 * A mobile client should describe the wire format it actually parses, not reach into a backend
 * package's internal implementation type it will never run against at runtime.
 *
 * Keep this in sync with `FlagEventEnvelope['payload']` by hand — a real drift-detection mechanism
 * (e.g. a shared `@fantasy-focus/wire-types` package) is future work, not this phase's scope.
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
  score: { home: number; away: number };
  quarter: number;
  time_remaining_sec: number;
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
  old_state: FlagState | null;
  new_state: FlagState;
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
