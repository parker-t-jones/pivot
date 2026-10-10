/**
 * Home binder for Sprint 10 Phase 3 realtime: connects only when `isLiveDisplayPhase`,
 * tears down on background/unmount, reconciles after re-connect, and reconnects on TOKEN_REFRESHED.
 */
import { useEffect, useRef } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';

import { getOrCreateDeviceId } from './deviceId';
import { shouldConnectHomeRealtime } from './homeState';
import type { FlagEventPayload } from './flagEventPayload';
import type { NflSeasonType } from './nflState';
import { RealtimeClient, type WebSocketConstructor } from './realtimeClient';
import type { GameStateMessage } from './schedule';
import { supabase } from './supabase';

export interface UseHomeRealtimeOptions {
  /** Schedule-derived `display_phase` — never `season_type`. Null while Home still loading. */
  displayPhase: NflSeasonType | null;
  hasLeagues: boolean;
  /** Home finished its initial load (socket must not race cold-start `/flags/current`). */
  homeReady: boolean;
  onFlagEvent: (payload: FlagEventPayload) => void;
  onGameState: (game: GameStateMessage) => void;
  /** Games on the week slate. Home sends `subscribe_game` for each. */
  gameIds: readonly string[];
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
    onGameState,
    gameIds,
    onReconcile,
    apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL,
    WebSocketImpl,
    getAccessToken = defaultGetAccessToken,
  } = options;

  const onFlagEventRef = useRef(onFlagEvent);
  const onGameStateRef = useRef(onGameState);
  const onReconcileRef = useRef(onReconcile);
  const clientRef = useRef<RealtimeClient | null>(null);
  const gameIdsRef = useRef(gameIds);
  onFlagEventRef.current = onFlagEvent;
  onGameStateRef.current = onGameState;
  onReconcileRef.current = onReconcile;
  gameIdsRef.current = gameIds;

  const shouldConnect = shouldConnectHomeRealtime({
    homeReady,
    hasLeagues,
    displayPhase,
  });

  useEffect(() => {
    if (!shouldConnect || !apiBaseUrl) {
      return;
    }

    let client: RealtimeClient | null = null;
    let removeVisibility: (() => void) | null = null;
    let appSub: { remove: () => void } | null = null;
    let authUnsubscribe: (() => void) | null = null;
    let cancelled = false;
    const platform = Platform.OS === 'web' ? 'web' : 'ios';

    void getOrCreateDeviceId().then((deviceId) => {
      if (cancelled) return;
      client = new RealtimeClient({
        apiBaseUrl,
        getAccessToken,
        WebSocketImpl,
        identity: { deviceId, platform },
        onFlagEvent: (payload) => {
          onFlagEventRef.current(payload);
        },
        onGameState: (game) => {
          onGameStateRef.current(game);
        },
        onReconnected: () => {
          void onReconcileRef.current();
        },
      });

      clientRef.current = client;
      client.setSubscribedGames(gameIdsRef.current);

      if (platform === 'web') {
        // A hidden tab stays connected. The visibility message is what stops it counting
        // as active, so a later Web Push can reach it. iOS still closes on background.
        const syncVisibility = () => {
          const hidden = globalThis.document?.visibilityState === 'hidden';
          client?.setVisibility(hidden ? 'hidden' : 'visible');
        };
        syncVisibility();
        client.start();
        const onVisibility = () => syncVisibility();
        globalThis.document?.addEventListener('visibilitychange', onVisibility);
        removeVisibility = () => globalThis.document?.removeEventListener('visibilitychange', onVisibility);
      } else {
        // Tear down only on true `background` (not `inactive` / Control Center).
        if (AppState.currentState === 'active') {
          client.start();
        }
        appSub = AppState.addEventListener('change', (next: AppStateStatus) => {
          if (next === 'background') {
            client?.stop();
          } else if (next === 'active' && client && !client.isStarted()) {
            client.start();
          }
        });
      }

      const {
        data: { subscription: authSub },
      } = supabase.auth.onAuthStateChange((event) => {
        if (event === 'TOKEN_REFRESHED' && client?.isOpen()) {
          client.reconnectForTokenRefresh();
        }
      });
      authUnsubscribe = () => authSub.unsubscribe();
    });

    return () => {
      cancelled = true;
      removeVisibility?.();
      appSub?.remove();
      authUnsubscribe?.();
      clientRef.current = null;
      client?.stop();
    };
  }, [shouldConnect, apiBaseUrl, getAccessToken, WebSocketImpl]);

  useEffect(() => {
    clientRef.current?.setSubscribedGames(gameIds);
  }, [gameIds]);
}
