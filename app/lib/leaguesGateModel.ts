/**
 * Pure helpers for leagues-gate invariants (testable without React).
 * Count is always derived from the list — never stored separately.
 */
import type { LeagueSummary } from './leagues';
import {
  deferConnectForSession,
  isConnectDeferredForSession,
  resetConnectDeferredForSessionForTests,
} from './connectDeferredSession';
import { resolveAppGate } from './navigationGates';

export interface LeaguesSnapshot {
  leagues: LeagueSummary[];
  leagueCount: number;
  leaguesRevision: number;
}

/** Apply a successful `/leagues` response — list and count update together. */
export function applyLeaguesRefresh(
  prev: LeaguesSnapshot,
  nextLeagues: LeagueSummary[],
): LeaguesSnapshot {
  return {
    leagues: nextLeagues,
    leagueCount: nextLeagues.length,
    leaguesRevision: prev.leaguesRevision + 1,
  };
}

/**
 * After Settings disconnects a league and refresh returns empty: defer the gate so the user
 * lands on Home State 5 instead of an immediate bounce to connect-team.
 */
export function afterLastLeagueDisconnected(): void {
  deferConnectForSession();
}

export function gateDecisionAfterLeaguesChange(input: {
  leagueCount: number;
  connectDeferred: boolean;
  routeLeaf: string | undefined;
}): ReturnType<typeof resolveAppGate> {
  return resolveAppGate({
    leaguesStatus: 'ready',
    leagueCount: input.leagueCount,
    connectDeferred: input.connectDeferred,
    routeLeaf: input.routeLeaf,
    pushStatus: 'denied',
    notificationsOnboarding: false,
  });
}

/** Test helper — re-export reset so league-flow tests share one cleanup. */
export { resetConnectDeferredForSessionForTests, isConnectDeferredForSession };
