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

export function sourceForPlatform(platform: string): RosteredStakeSource | null {
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

export interface WeekGame {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
}

/**
 * Team → `games.id` when that team is in exactly one game.
 * Zero games is a bye. More than one game is left unresolved so a stake is not attached to a guess.
 */
export function gameIdByTeam(games: readonly WeekGame[]): Map<string, string> {
  const gameIdsByTeam = new Map<string, Set<string>>();
  for (const game of games) {
    for (const teamId of [game.homeTeamId, game.awayTeamId]) {
      const ids = gameIdsByTeam.get(teamId) ?? new Set<string>();
      ids.add(game.id);
      gameIdsByTeam.set(teamId, ids);
    }
  }

  const resolved = new Map<string, string>();
  for (const [teamId, ids] of gameIdsByTeam) {
    if (ids.size !== 1) continue;
    const gameId = [...ids][0];
    if (gameId) resolved.set(teamId, gameId);
  }
  return resolved;
}

export interface StoredRosteredStake {
  id: string;
  playerId: string;
  teamId: string;
  gameId: string;
}

export interface RosteredSetDiff {
  deleteIds: string[];
  inserts: RosteredStakeInsert[];
  updates: { id: string; gameId: string; subject: RosteredStakeInsert['subject'] }[];
}

/**
 * Replace one `(user, season, week, source, source_ref)` set.
 * A second call with the stored result is empty, so backfill and write-through are idempotent.
 * Disconnect is the empty `next` set: every stored id is deleted.
 */
export function diffRosteredSet(
  existing: readonly StoredRosteredStake[],
  next: readonly RosteredStakeInsert[],
): RosteredSetDiff {
  const existingByPlayer = new Map(existing.map((row) => [row.playerId, row]));
  const nextIds = new Set(next.map((row) => row.subject.playerId));
  const deleteIds: string[] = [];
  const inserts: RosteredStakeInsert[] = [];
  const updates: RosteredSetDiff['updates'] = [];

  for (const row of existing) {
    if (!nextIds.has(row.playerId)) deleteIds.push(row.id);
  }

  for (const row of next) {
    const current = existingByPlayer.get(row.subject.playerId);
    if (!current) {
      inserts.push(row);
      continue;
    }
    if (current.gameId !== row.gameId || current.teamId !== row.subject.teamId) {
      updates.push({ id: current.id, gameId: row.gameId, subject: row.subject });
    }
  }

  return { deleteIds, inserts, updates };
}
