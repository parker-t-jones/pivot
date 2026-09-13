import type { FlagReason, FlagState, GameState, UnitOnField } from '@pivot/shared';

/**
 * Serialization for the Section 7 Redis hashes. `@upstash/redis` JSON-parses hash values on read
 * (so a stored `"14"` may come back as the number `14`, and a stored JSON array as an object), so the
 * readers below coerce defensively from `unknown` and never assume the stored wire type. All values
 * are written as strings for deterministic round-trips.
 */

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

function toStringOrEmpty(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/** Empty string ↔ null, matching `possession_team_id`. */
function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = toNumber(value);
  return Number.isFinite(n) ? n : null;
}

function nullableNumberToString(value: number | null): string {
  return value === null ? '' : String(value);
}

// --- game_state:{game_id} hash (Section 7) ---
//
// Section 7 lists possession_team_id, unit_on_field, score_home, score_away, quarter,
// time_remaining_sec, yards_to_opponent_endzone, down, distance, in_red_zone, updated_at.
// A faithful `GameState` round-trip (Section 8 type) also needs game_id, home_team_id,
// away_team_id, status — stored here as a necessary superset of Section 7's illustrative field
// list (there is no separate writer; this provider owns the key).

export function serializeGameState(state: GameState): Record<string, string> {
  return {
    game_id: state.gameId,
    home_team_id: state.homeTeamId,
    away_team_id: state.awayTeamId,
    possession_team_id: state.possessionTeamId ?? '',
    unit_on_field: state.unitOnField,
    score_home: String(state.scoreHome),
    score_away: String(state.scoreAway),
    quarter: String(state.quarter),
    time_remaining_sec: String(state.timeRemainingSec),
    yards_to_opponent_endzone: nullableNumberToString(state.yardsToOpponentEndzone),
    down: nullableNumberToString(state.down),
    distance: nullableNumberToString(state.distance),
    in_red_zone: state.inRedZone ? '1' : '0',
    status: state.status,
    updated_at: String(state.updatedAt),
  };
}

export function deserializeGameState(raw: Record<string, unknown>): GameState {
  const possession = toStringOrEmpty(raw['possession_team_id']);
  return {
    gameId: toStringOrEmpty(raw['game_id']),
    homeTeamId: toStringOrEmpty(raw['home_team_id']),
    awayTeamId: toStringOrEmpty(raw['away_team_id']),
    possessionTeamId: possession === '' ? null : possession,
    unitOnField: toStringOrEmpty(raw['unit_on_field']) as UnitOnField,
    scoreHome: toNumber(raw['score_home']),
    scoreAway: toNumber(raw['score_away']),
    quarter: toNumber(raw['quarter']),
    timeRemainingSec: toNumber(raw['time_remaining_sec']),
    yardsToOpponentEndzone: toNullableNumber(raw['yards_to_opponent_endzone']),
    down: toNullableNumber(raw['down']),
    distance: toNullableNumber(raw['distance']),
    inRedZone: toNumber(raw['in_red_zone']) === 1,
    status: toStringOrEmpty(raw['status']) as GameState['status'],
    updatedAt: toNumber(raw['updated_at']),
  };
}

// --- user_flag_state:{user_id}:{game_id} hash (sprint decision #3, Section 7 addition) ---

export function serializeFlagState(state: FlagState): Record<string, string> {
  return {
    game_id: state.gameId,
    flagged: state.flagged ? '1' : '0',
    priority_score: String(state.priorityScore),
    reasons: JSON.stringify(state.reasons),
    computed_at: String(state.computedAt),
  };
}

function parseReasons(value: unknown): FlagReason[] {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  return Array.isArray(parsed) ? (parsed as FlagReason[]) : [];
}

export function deserializeFlagState(raw: Record<string, unknown>): FlagState {
  return {
    gameId: toStringOrEmpty(raw['game_id']),
    flagged: toNumber(raw['flagged']) === 1,
    priorityScore: toNumber(raw['priority_score']),
    reasons: parseReasons(raw['reasons']),
    computedAt: toNumber(raw['computed_at']),
  };
}
