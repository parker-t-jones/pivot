/**
 * Sprint 10 Phase 4 — server-truth league count + session-scoped connectDeferred for the zero-leagues gate.
 * Deferred is backed by `connectDeferredSession` (sync + survives provider remount); React state
 * mirrors it so consumers re-render.
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
import { fetchLeagues } from '../lib/leagues';
import type { LeaguesLoadStatus } from '../lib/navigationGates';

interface LeaguesGateContextValue {
  status: LeaguesLoadStatus;
  leagueCount: number;
  errorMessage: string | null;
  /**
   * Always reads the session module (sync truth), not a possibly-stale render snapshot alone.
   * `deferConnect` also bumps React state so subscribers re-render.
   */
  connectDeferred: boolean;
  deferConnect: () => void;
  /** Re-fetch `/leagues`. Safe during retry: sets status to `checking` so gates wait (no mid-flight redirect). */
  refreshLeagues: () => Promise<void>;
  /** After a successful connect — bump count optimistically and clear deferred before navigating. */
  notifyLeagueConnected: () => void;
}

const LeaguesGateContext = createContext<LeaguesGateContextValue | undefined>(undefined);

export function LeaguesGateProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<LeaguesLoadStatus>('checking');
  const [leagueCount, setLeagueCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** Mirror tick — forces re-render after defer/clear; gate reads `isConnectDeferredForSession()`. */
  const [deferredEpoch, setDeferredEpoch] = useState(0);

  const refreshLeagues = useCallback(async () => {
    setStatus('checking');
    setErrorMessage(null);
    try {
      const leagues = await fetchLeagues();
      setLeagueCount(leagues.length);
      if (leagues.length > 0) {
        clearConnectDeferredForSession();
        setDeferredEpoch((n) => n + 1);
      }
      setStatus('ready');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not load your leagues.';
      setErrorMessage(message);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void refreshLeagues();
  }, [refreshLeagues]);

  const deferConnect = useCallback(() => {
    deferConnectForSession();
    setDeferredEpoch((n) => n + 1);
  }, []);

  const notifyLeagueConnected = useCallback(() => {
    clearConnectDeferredForSession();
    setLeagueCount((count) => Math.max(count, 1));
    setDeferredEpoch((n) => n + 1);
    setStatus('ready');
    setErrorMessage(null);
  }, []);

  const connectDeferred = isConnectDeferredForSession();

  const value = useMemo<LeaguesGateContextValue>(
    () => ({
      status,
      leagueCount,
      errorMessage,
      connectDeferred,
      deferConnect,
      refreshLeagues,
      notifyLeagueConnected,
    }),
    [
      status,
      leagueCount,
      errorMessage,
      connectDeferred,
      deferredEpoch,
      deferConnect,
      refreshLeagues,
      notifyLeagueConnected,
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
