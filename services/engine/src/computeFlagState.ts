import type { FlagReason, FlagState, GameState, UserLineupCache } from '@pivot/shared';
import { defaultClock, type Clock } from './clock.js';

/**
 * The user's player ids on a given team, sorted for determinism.
 *
 * Section 8 calls `playerIdsOnTeamWithPosition(lineup, team, 'offense' | 'defense')`, implying a
 * per-player position filter. The Sprint 3 `UserLineupCache` only carries position categories at the
 * *team* level (`teamPositions`), not per player, so we can't filter a team's players by category
 * here. That distinction is instead enforced upstream: `teamPositions.get(team)?.has(category)` gates
 * whether the offense/defense rule fires at all. The one case this diverges from a strict reading is
 * a user owning both an offensive player AND that same team's DEF — not among Section 8's scenarios,
 * and rare in one-league v1 play. See sprint summary "harder to interpret" note.
 *
 * IDP support (v1.5+) would break this shortcut: with individual defensive players, a single team can
 * have both offensive and defensive players *at the player level* that must be distinguished. That
 * would require growing `UserLineupCache` to carry per-player position categories, and updating this
 * function to filter a team's players by the requested category rather than returning them all.
 */
function playerIdsOnTeam(lineup: UserLineupCache, teamId: string): string[] {
  return [...lineup.playerToTeam.entries()]
    .filter(([, team]) => team === teamId)
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
    const triggers = playerIdsOnTeam(lineup, offTeam);
    reasons.push({ type: 'offense_active', triggeringPlayerIds: triggers });
    priority += 2 * triggers.length;
  }

  // Defense rule
  if (state.unitOnField === 'offense' && lineup.teamPositions.get(defTeam)?.has('defense')) {
    const triggers = playerIdsOnTeam(lineup, defTeam);
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
