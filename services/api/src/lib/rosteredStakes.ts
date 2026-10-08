/**
 * Pure ROSTERED stake rows from lineup slots.
 *
 * The active-slot filter matches `rebuildUserLineupCache`: `starter` and `flex`.
 * Bench and idp are omitted. A team with no game this week is a bye and gets no row.
 * Watched-league filtering stays out of this mapper; every connected league is stored.
 */

export type RosteredStakeSource = 'SLEEPER_ROSTER' | 'MANUAL';

export interface RosteredStakeSlot {
  playerId: string;
  teamId: string;
  position: string;
  slotType: string;
  leagueId: string;
  platform: string;
}

export interface RosteredStakesContext {
  userId: string;
  season: number;
  week: number;
  /** Team id → `games.id` for this season and week. A missing team is a bye. */
  gameIdByTeamId: ReadonlyMap<string, string>;
}

export interface RosteredStakeInsert {
  userId: string;
  season: number;
  week: number;
  gameId: string;
  subject: { type: 'PLAYER'; playerId: string; teamId: string };
  condition: { type: 'ROSTERED' };
  source: RosteredStakeSource;
  sourceRef: string;
  weight: number;
}

/** Same slots `rebuildUserLineupCache` reads from `lineup_slots`. */
const ACTIVE_SLOT_TYPES = new Set(['starter', 'flex']);

function sourceForPlatform(platform: string): RosteredStakeSource | null {
  if (platform === 'sleeper') return 'SLEEPER_ROSTER';
  if (platform === 'manual') return 'MANUAL';
  return null;
}

export function rosteredStakesFor(
  slots: readonly RosteredStakeSlot[],
  ctx: RosteredStakesContext,
): RosteredStakeInsert[] {
  const seen = new Set<string>();
  const rows: RosteredStakeInsert[] = [];

  for (const slot of slots) {
    if (!ACTIVE_SLOT_TYPES.has(slot.slotType)) continue;
    const source = sourceForPlatform(slot.platform);
    if (!source) continue;
    const gameId = ctx.gameIdByTeamId.get(slot.teamId);
    if (!gameId) continue;

    const key = `${slot.leagueId}:${slot.playerId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      userId: ctx.userId,
      season: ctx.season,
      week: ctx.week,
      gameId,
      subject: { type: 'PLAYER', playerId: slot.playerId, teamId: slot.teamId },
      condition: { type: 'ROSTERED' },
      source,
      sourceRef: slot.leagueId,
      weight: 1,
    });
  }

  return rows;
}
