import type { SlotType } from '@roster-remote/shared';

export interface RosterMappingSlot {
  /** Sleeper `player_id` (or team abbreviation for DEF) — resolved against `players.sleeper_id` by the caller. */
  externalPlayerId: string;
  slotType: SlotType;
  positionInLineup: string;
}

/** Non-starting roster slots — never produce a lineup slot. */
const BENCH_LIKE_ROSTER_POSITIONS = new Set(['BN', 'TAXI', 'IR']);

/** Sleeper's flex-style slot labels; mapped to `slot_type: 'flex'` rather than `'starter'`. */
const FLEX_ROSTER_POSITIONS = new Set(['FLEX', 'SUPER_FLEX', 'WRRB_FLEX', 'REC_FLEX']);

/** Lineup positions in scope for v1 (Section 4 — IDP explicitly out of scope). */
const ALLOWED_LINEUP_POSITIONS = new Set([
  'QB',
  'RB',
  'WR',
  'TE',
  'K',
  'DEF',
  ...FLEX_ROSTER_POSITIONS,
]);

/** Sleeper's placeholder for an empty roster slot. */
const EMPTY_SLOT_PLAYER_ID = '0';

/**
 * Maps a Sleeper roster + week's starters/players into normalized lineup slots
 * (Section 7 `lineup_slots.slot_type` / `position_in_lineup`).
 *
 * Pure and DB-agnostic: IDP/offense-vs-defense position validity against our seeded
 * `players` table is resolved by the caller (`SleeperProvider`), not here — any
 * `externalPlayerId` that doesn't resolve to a seeded player (including all IDP players,
 * which are never seeded) is simply dropped downstream.
 *
 * @param rosterPositions Sleeper `league.roster_positions`, ordered, includes bench/IDP slots.
 * @param starters Sleeper `matchup.starters` for this roster/week — one player_id per
 *   non-bench slot in `rosterPositions`, in the same order (Sleeper's contract).
 * @param players Sleeper `matchup.players` for this roster/week — every player_id on the roster.
 */
export function mapRosterToLineupSlots(
  rosterPositions: readonly string[],
  starters: readonly string[],
  players: readonly string[],
): RosterMappingSlot[] {
  const startingRosterPositions = rosterPositions.filter(
    (position) => !BENCH_LIKE_ROSTER_POSITIONS.has(position),
  );

  const eligiblePairs = startingRosterPositions
    .map((position, index) => ({ position, playerId: starters[index] }))
    .filter(
      (pair): pair is { position: string; playerId: string } =>
        pair.playerId !== undefined &&
        pair.playerId !== EMPTY_SLOT_PLAYER_ID &&
        ALLOWED_LINEUP_POSITIONS.has(pair.position),
    );

  const totalByPosition = new Map<string, number>();
  for (const { position } of eligiblePairs) {
    totalByPosition.set(position, (totalByPosition.get(position) ?? 0) + 1);
  }

  const ordinalByPosition = new Map<string, number>();
  const starterSlots: RosterMappingSlot[] = eligiblePairs.map(({ position, playerId }) => {
    const ordinal = (ordinalByPosition.get(position) ?? 0) + 1;
    ordinalByPosition.set(position, ordinal);
    const total = totalByPosition.get(position) ?? 1;
    return {
      externalPlayerId: playerId,
      slotType: FLEX_ROSTER_POSITIONS.has(position) ? 'flex' : 'starter',
      positionInLineup: total > 1 ? `${position}${ordinal}` : position,
    };
  });

  const starterIds = new Set(starters);
  const benchSlots: RosterMappingSlot[] = players
    .filter((playerId) => playerId !== EMPTY_SLOT_PLAYER_ID && !starterIds.has(playerId))
    .map((playerId) => ({
      externalPlayerId: playerId,
      slotType: 'bench',
      positionInLineup: 'BN',
    }));

  return [...starterSlots, ...benchSlots];
}
