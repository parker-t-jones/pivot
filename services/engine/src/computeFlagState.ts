import type { FlagReason, FlagState, GameState, UserLineupCache } from '@pivot/shared';
import { defaultClock, type Clock } from './clock.js';

/**
 * The user's player ids on a given team and side of the ball, sorted for determinism.
 *
 * Section 8's `playerIdsOnTeamWithPosition`. `teamPositions` still gates whether the rule fires.
 * `playerUnits` (QB/RB/WR/TE/K → offense, DEF → defense) decides who is listed. A cache written
 * before `playerUnits` existed has no map: every player on the team is listed, so flagged state
 * and priority stay what they were until the next rebuild.
 */
function playerIdsOnTeam(
  lineup: UserLineupCache,
  teamId: string,
  unit: 'offense' | 'defense',
): string[] {
  return [...lineup.playerToTeam.entries()]
    .filter(([playerId, team]) => {
      if (team !== teamId) return false;
      if (!lineup.playerUnits) return true;
      return lineup.playerUnits.get(playerId) === unit;
    })
    .map(([playerId]) => playerId)
    .sort();
}

/**
 * Section 8 `isCloseLateGame`, extended for overtime per the Section 8 edge case: "Quarter 5 always
 * triggers close_game bonus regardless of score margin."
 */
function isCloseLateGame(s: GameState): boolean {
  if (s.quarter >= 5) return true;
  return s.quarter >= 4 && Math.abs(s.scoreHome - s.scoreAway) <= 7;
}

/** Stars among the players already triggering this flag (offense/defense reasons). */
function activeStarsInThisFlag(lineup: UserLineupCache, reasons: FlagReason[]): string[] {
  const triggering = new Set<string>();
  for (const reason of reasons) {
    for (const playerId of reason.triggeringPlayerIds) triggering.add(playerId);
  }
  return [...triggering].filter((playerId) => lineup.starPlayerIds.has(playerId)).sort();
}

/**
 * Pure, deterministic flag-state computation (PLAN.md Section 8). Given a user's lineup cache and a
 * game's current state, returns whether the game is flagged, its priority score, and the reasons.
 *
 * The priority formula and rule order are verbatim Section 8; `clock` is the only addition — an
 * injected timestamp source so the function is deterministic under test (sprint decision #1). It does
 * NOT alter any scoring.
 */
export function computeFlagState(
  lineup: UserLineupCache,
  state: GameState,
  clock: Clock = defaultClock,
): FlagState {
  const reasons: FlagReason[] = [];
  let priority = 0;

  if (state.status !== 'in_progress' || state.possessionTeamId === null) {
    return {
      gameId: state.gameId,
      flagged: false,
      priorityScore: 0,
      reasons: [],
      computedAt: clock(),
    };
  }

  const offTeam = state.possessionTeamId;
  const defTeam = offTeam === state.homeTeamId ? state.awayTeamId : state.homeTeamId;

  // Offense rule
  if (state.unitOnField === 'offense' && lineup.teamPositions.get(offTeam)?.has('offense')) {
    const triggers = playerIdsOnTeam(lineup, offTeam, 'offense');
    reasons.push({ type: 'offense_active', triggeringPlayerIds: triggers });
    priority += 2 * triggers.length;
  }

  // Defense rule
  if (state.unitOnField === 'offense' && lineup.teamPositions.get(defTeam)?.has('defense')) {
    const triggers = playerIdsOnTeam(lineup, defTeam, 'defense');
    reasons.push({ type: 'defense_active', triggeringPlayerIds: triggers });
    priority += 2;
  }

  // Bonuses only apply if the game is already flagged.
  if (reasons.length > 0) {
    if (state.inRedZone) {
      reasons.push({ type: 'red_zone', triggeringPlayerIds: [] });
      priority += 3;
    }
    if (isCloseLateGame(state)) {
      reasons.push({ type: 'close_game', triggeringPlayerIds: [] });
      priority += 2;
    }
    const activeStars = activeStarsInThisFlag(lineup, reasons);
    if (activeStars.length > 0) {
      reasons.push({ type: 'star_player_active', triggeringPlayerIds: activeStars });
      priority += 5 * activeStars.length;
    }
  }

  return {
    gameId: state.gameId,
    flagged: reasons.length > 0,
    priorityScore: priority,
    reasons,
    computedAt: clock(),
  };
}
