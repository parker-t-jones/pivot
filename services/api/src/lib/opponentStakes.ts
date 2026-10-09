import type { StakeSetInsert } from './rosteredStakes.js';

const ACTIVE_SLOT_TYPES = new Set(['starter', 'flex']);

export interface OpponentStakeSlot {
  playerId: string;
  teamId: string;
  position: string;
  slotType: string;
}

export interface OpponentStakesContext {
  userId: string;
  season: number;
  week: number;
  leagueId: string;
  /** Team id → regular-season `games.id`. A missing team is a bye. */
  gameIdByTeamId: ReadonlyMap<string, string>;
}

export interface OpponentStakeInsert extends StakeSetInsert {
  condition: { type: 'OPPONENT_ROSTERED' };
  source: 'SLEEPER_OPPONENT';
}

/**
 * Opponent starter and flex rows for one league week.
 * A team with no regular-season game is a bye and gets no row.
 */
export function opponentStakesFor(
  slots: readonly OpponentStakeSlot[],
  ctx: OpponentStakesContext,
): OpponentStakeInsert[] {
  const seen = new Set<string>();
  const rows: OpponentStakeInsert[] = [];

  for (const slot of slots) {
    if (!ACTIVE_SLOT_TYPES.has(slot.slotType)) continue;
    const gameId = ctx.gameIdByTeamId.get(slot.teamId);
    if (!gameId) continue;
    if (seen.has(slot.playerId)) continue;
    seen.add(slot.playerId);

    rows.push({
      userId: ctx.userId,
      season: ctx.season,
      week: ctx.week,
      gameId,
      subject: { type: 'PLAYER', playerId: slot.playerId, teamId: slot.teamId },
      condition: { type: 'OPPONENT_ROSTERED' },
      source: 'SLEEPER_OPPONENT',
      sourceRef: ctx.leagueId,
      weight: 0.5,
    });
  }

  return rows;
}

/**
 * Drop opponent slots whose Sleeper id is not in `players`. Those ids are unresolved
 * and belong in the existing lineup-sync log; they are not a failed sync by themselves.
 */
export function resolveOpponentStakeSlots(
  lineup: readonly { externalPlayerId: string; slotType: string }[],
  playersBySleeperId: ReadonlyMap<string, { id: string; team_id: string; position: string }>,
): { slots: OpponentStakeSlot[]; unresolvedIds: string[] } {
  const unresolvedIds: string[] = [];
  const seen = new Set<string>();
  const slots: OpponentStakeSlot[] = [];

  for (const slot of lineup) {
    if (!ACTIVE_SLOT_TYPES.has(slot.slotType)) continue;
    if (seen.has(slot.externalPlayerId)) continue;
    seen.add(slot.externalPlayerId);
    const player = playersBySleeperId.get(slot.externalPlayerId);
    if (!player) {
      unresolvedIds.push(slot.externalPlayerId);
      continue;
    }
    slots.push({
      playerId: player.id,
      teamId: player.team_id,
      position: player.position,
      slotType: slot.slotType,
    });
  }

  return { slots, unresolvedIds };
}
