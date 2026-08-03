/**
 * Home binder for Sprint 10 Phase 3 realtime: connects only when `isLiveDisplayPhase`,
 * tears down on background/unmount, reconciles after re-connect, and reconnects on TOKEN_REFRESHED.
 */
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { shouldConnectHomeRealtime } from './homeState';
import type { FlagEventPayload } from './flagEventPayload';
import type { NflSeasonType } from './nflState';
import { RealtimeClient, type WebSocketConstructor } from './realtimeClient';
import { supabase } from './supabase';

export interface UseHomeRealtimeOptions {
  /** Schedule-derived `display_phase` — never `season_type`. Null while Home still loading. */
  displayPhase: NflSeasonType | null;
  hasLeagues: boolean;
  /** Home finished its initial load (socket must not race cold-start `/flags/current`). */
  homeReady: boolean;
  onFlagEvent: (payload: FlagEventPayload) => void;
  /** Refetch `/flags/current` after re-connect / foreground resume (not initial mount connect). */
  onReconcile: () => void | Promise<void>;
  /** Test seam — omit in production (uses platform WebSocket + env base URL). */
  apiBaseUrl?: string;
  WebSocketImpl?: WebSocketConstructor;
  getAccessToken?: () => Promise<string | null>;
}

async function defaultGetAccessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  return data.session.access_token;
}

export function useHomeRealtime(options: UseHomeRealtimeOptions): void {
  const {
    displayPhase,
    hasLeagues,
    homeReady,
    onFlagEvent,
    onReconcile,
    apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL,
    WebSocketImpl,
    getAccessToken = defaultGetAccessToken,
  } = options;

  const onFlagEventRef = useRef(onFlagEvent);
  const onReconcileRef = useRef(onReconcile);
  onFlagEventRef.current = onFlagEvent;
  onReconcileRef.current = onReconcile;

  const shouldConnect = shouldConnectHomeRealtime({
    homeReady,
    hasLeagues,
    displayPhase,
  });

  useEffect(() => {
    if (!shouldConnect || !apiBaseUrl) {
      return;
    }

    const client = new RealtimeClient({
      apiBaseUrl,
      getAccessToken,
      WebSocketImpl,
      onFlagEvent: (payload) => {
        onFlagEventRef.current(payload);
      },
      onReconnected: () => {
        void onReconcileRef.current();
      },
    });

    // Connect when foregrounded. Tear down only on true `background` (not `inactive` /
    // Control Center), per Phase 3 — avoids reconnect thrash on brief inactive transitions.
    if (AppState.currentState === 'active') {
      client.start();
    }

    const appSub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background') {
        client.stop();
      } else if (next === 'active' && !client.isStarted()) {
        // Foreground resume after background stop — hasConnectedOnce stays true → onReconnected.
        client.start();
      }
    });

    const {
      data: { subscription: authSub },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'TOKEN_REFRESHED' && client.isOpen()) {
        client.reconnectForTokenRefresh();
      }
    });

    return () => {
      appSub.remove();
      authSub.unsubscribe();
      client.stop();
    };
  }, [shouldConnect, apiBaseUrl, getAccessToken, WebSocketImpl]);
}
