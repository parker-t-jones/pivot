/**
 * Sprint 10 Phase 4+ — single owner of `GET /leagues` for the app group.
 * Home and Settings consume this list; they must not keep a competing copy.
 *
 * `leagueCount` is always `leagues.length` — never updated independently (no optimistic count bump).
 * `leaguesRevision` bumps on every successful refresh so Home can reload its rich display pipeline.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import {
  clearConnectDeferredForSession,
  deferConnectForSession,
  isConnectDeferredForSession,
} from '../lib/connectDeferredSession';
import { fetchLeagues, type LeagueSummary } from '../lib/leagues';
import type { LeaguesLoadStatus } from '../lib/navigationGates';

interface LeaguesGateContextValue {
  status: LeaguesLoadStatus;
  /** Server list — single source of truth. */
  leagues: LeagueSummary[];
  /** Always `leagues.length`. */
  leagueCount: number;
  /** Increments on every successful refresh — Home reloads when this changes. */
  leaguesRevision: number;
  errorMessage: string | null;
  connectDeferred: boolean;
  deferConnect: () => void;
  /**
   * Re-fetch `/leagues`, replace list+count together, bump revision.
   * Sets status to `checking` while in flight so gates wait (no mid-flight redirect).
   * Returns the fresh list so callers can await before navigate / lineup loads.
   */
  refreshLeagues: () => Promise<LeagueSummary[]>;
}

const LeaguesGateContext = createContext<LeaguesGateContextValue | undefined>(undefined);

export function LeaguesGateProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<LeaguesLoadStatus>('checking');
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [leaguesRevision, setLeaguesRevision] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deferredEpoch, setDeferredEpoch] = useState(0);

  const refreshLeagues = useCallback(async (): Promise<LeagueSummary[]> => {
    setStatus('checking');
    setErrorMessage(null);
    try {
      const next = await fetchLeagues();
      setLeagues(next);
      setLeaguesRevision((n) => n + 1);
      if (next.length > 0) {
        clearConnectDeferredForSession();
        setDeferredEpoch((n) => n + 1);
      }
      setStatus('ready');
      return next;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not load your leagues.';
      setErrorMessage(message);
      setStatus('error');
      throw error instanceof Error ? error : new Error(message);
    }
  }, []);

  useEffect(() => {
    void refreshLeagues().catch(() => {
      // status/error already set inside refreshLeagues
    });
  }, [refreshLeagues]);

  const deferConnect = useCallback(() => {
    deferConnectForSession();
    setDeferredEpoch((n) => n + 1);
  }, []);

  const connectDeferred = isConnectDeferredForSession();
  const leagueCount = leagues.length;

  const value = useMemo<LeaguesGateContextValue>(
    () => ({
      status,
      leagues,
      leagueCount,
      leaguesRevision,
      errorMessage,
      connectDeferred,
      deferConnect,
      refreshLeagues,
    }),
    [
      status,
      leagues,
      leagueCount,
      leaguesRevision,
      errorMessage,
      connectDeferred,
      deferredEpoch,
      deferConnect,
      refreshLeagues,
    ],
  );

  return <LeaguesGateContext.Provider value={value}>{children}</LeaguesGateContext.Provider>;
}

export function useLeaguesGate(): LeaguesGateContextValue {
  const value = useContext(LeaguesGateContext);
  if (!value) {
    throw new Error('useLeaguesGate must be used within LeaguesGateProvider');
  }
  return value;
}
