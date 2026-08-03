import { afterEach, describe, expect, it } from 'vitest';

import {
  afterLastLeagueDisconnected,
  applyLeaguesRefresh,
  gateDecisionAfterLeaguesChange,
  isConnectDeferredForSession,
  resetConnectDeferredForSessionForTests,
  type LeaguesSnapshot,
} from './leaguesGateModel';
import type { LeagueSummary } from './leagues';

function league(id: string): LeagueSummary {
  return {
    league_id: id,
    platform: 'sleeper',
    name: `League ${id}`,
    sport: 'nfl',
    season_year: 2026,
    last_synced_at: null,
  };
}

describe('applyLeaguesRefresh — count and list never diverge', () => {
  it('sets leagueCount from leagues.length on connect (0 → 1)', () => {
    const empty: LeaguesSnapshot = { leagues: [], leagueCount: 0, leaguesRevision: 0 };
    const next = applyLeaguesRefresh(empty, [league('a')]);
    expect(next.leagueCount).toBe(next.leagues.length);
    expect(next.leagueCount).toBe(1);
    expect(next.leaguesRevision).toBe(1);
  });

  it('sets leagueCount from leagues.length on disconnect last (1 → 0)', () => {
    const one: LeaguesSnapshot = {
      leagues: [league('a')],
      leagueCount: 1,
      leaguesRevision: 1,
    };
    const next = applyLeaguesRefresh(one, []);
    expect(next.leagueCount).toBe(0);
    expect(next.leagues).toEqual([]);
    expect(next.leagueCount).toBe(next.leagues.length);
    expect(next.leaguesRevision).toBe(2);
  });

  it('never allows an optimistic count without a matching list entry', () => {
    // Documented invariant: there is no API that sets count without replacing the list.
    const next = applyLeaguesRefresh(
      { leagues: [], leagueCount: 0, leaguesRevision: 0 },
      [league('a'), league('b')],
    );
    expect(next.leagueCount).toBe(2);
    expect(next.leagues.map((l) => l.league_id)).toEqual(['a', 'b']);
  });
});

describe('Home / gate reactions to leagues changes', () => {
  afterEach(() => {
    resetConnectDeferredForSessionForTests();
  });

  it('connect from State 5: revision bump with count≥1 → Home can leave State 5; gate renders', () => {
    const afterConnect = applyLeaguesRefresh(
      { leagues: [], leagueCount: 0, leaguesRevision: 0 },
      [league('a')],
    );
    expect(afterConnect.leagueCount).toBeGreaterThan(0);
    // Gate on Home with leagues — no redirect to connect
    expect(
      gateDecisionAfterLeaguesChange({
        leagueCount: afterConnect.leagueCount,
        connectDeferred: false,
        routeLeaf: 'index',
      }),
    ).toEqual({ action: 'render' });
  });

  it('disconnect last league: Home State 5 path (count 0) without immediate gate bounce', () => {
    afterLastLeagueDisconnected();
    expect(isConnectDeferredForSession()).toBe(true);

    const afterDisconnect = applyLeaguesRefresh(
      { leagues: [league('a')], leagueCount: 1, leaguesRevision: 1 },
      [],
    );
    expect(afterDisconnect.leagueCount).toBe(0);

    // On Home with deferred — render State 5, do not redirect_connect
    expect(
      gateDecisionAfterLeaguesChange({
        leagueCount: 0,
        connectDeferred: isConnectDeferredForSession(),
        routeLeaf: 'index',
      }),
    ).toEqual({ action: 'render' });
  });

  it('cold start after last-league disconnect: deferred cleared → gate re-prompts', () => {
    afterLastLeagueDisconnected();
    // Simulate force-quit: module reset (new JS context)
    resetConnectDeferredForSessionForTests();
    expect(isConnectDeferredForSession()).toBe(false);

    expect(
      gateDecisionAfterLeaguesChange({
        leagueCount: 0,
        connectDeferred: false,
        routeLeaf: 'index',
      }),
    ).toEqual({ action: 'redirect_connect' });
  });
});
