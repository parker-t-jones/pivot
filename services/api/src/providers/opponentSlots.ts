import type { NormalizedLineupSlot } from './fantasy-provider.js';
import { mapRosterToLineupSlots } from './roster-mapping.js';
import type { SleeperMatchup, SleeperRoster } from './sleeper-client.js';

const ACTIVE_SLOT_TYPES = new Set(['starter', 'flex']);

export interface OpponentSlotOptions {
  /** League `roster_positions`, so flex labels match the user's own lineup. */
  rosterPositions?: readonly string[];
  /**
   * `/rosters` rows already loaded because the user's matchup `starters` was null.
   * A null matchup `starters` array is not usable; `players` is the full roster, not
   * the starter list. The fallback is `roster.starters ?? []`, the same list
   * `fetchLineup` passes to `mapRosterToLineupSlots`.
   */
  rosters?: readonly Pick<SleeperRoster, 'roster_id' | 'starters' | 'players'>[];
}

/**
 * Opponent starter and flex slots from one `/matchups/{week}` response.
 * Bye week (`matchup_id` null) and a missing own roster are an empty list.
 * No other row with the same `matchup_id` is an empty list and one log.
 */
export function opponentSlotsFrom(
  matchups: readonly SleeperMatchup[],
  myRosterId: string,
  options?: OpponentSlotOptions,
): NormalizedLineupSlot[] {
  const mine = matchups.find((row) => String(row.roster_id) === myRosterId);
  if (!mine || mine.matchup_id == null) return [];

  const opponents = matchups.filter(
    (row) => row.matchup_id === mine.matchup_id && String(row.roster_id) !== myRosterId,
  );
  if (opponents.length === 0) {
    console.error(
      `[stakes] no opponent matchup roster=${myRosterId} matchup_id=${String(mine.matchup_id)}`,
    );
    return [];
  }

  const positions = options?.rosterPositions ?? [];
  const slots: NormalizedLineupSlot[] = [];
  const seen = new Set<string>();
  for (const row of opponents) {
    for (const slot of activeSlots(row, positions, options?.rosters)) {
      if (seen.has(slot.externalPlayerId)) continue;
      seen.add(slot.externalPlayerId);
      slots.push(slot);
    }
  }
  return slots;
}

function activeSlots(
  row: SleeperMatchup,
  rosterPositions: readonly string[],
  rosters: OpponentSlotOptions['rosters'],
): NormalizedLineupSlot[] {
  const starters = starterIds(row, rosters);
  const players = playerIds(row, rosters);
  if (rosterPositions.length === 0) {
    return starters
      .filter((playerId) => playerId.length > 0 && playerId !== '0')
      .map((playerId) => ({
        externalPlayerId: playerId,
        slotType: 'starter' as const,
        positionInLineup: 'starter',
      }));
  }
  return mapRosterToLineupSlots(rosterPositions, starters, players).filter((slot) =>
    ACTIVE_SLOT_TYPES.has(slot.slotType),
  );
}

/** Matchup `starters` when Sleeper snapshotted them; otherwise the `/rosters` starter list. */
function starterIds(row: SleeperMatchup, rosters: OpponentSlotOptions['rosters']): string[] {
  if (Array.isArray(row.starters)) return row.starters;
  return rosterFor(row, rosters)?.starters ?? [];
}

function playerIds(row: SleeperMatchup, rosters: OpponentSlotOptions['rosters']): string[] {
  if (Array.isArray(row.starters)) return row.players ?? [];
  return rosterFor(row, rosters)?.players ?? [];
}

function rosterFor(row: SleeperMatchup, rosters: OpponentSlotOptions['rosters']) {
  return rosters?.find((roster) => String(roster.roster_id) === String(row.roster_id));
}
