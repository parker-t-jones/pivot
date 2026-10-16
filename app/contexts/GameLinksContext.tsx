import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import {
  deleteGameLink,
  fetchGameLinks,
  saveGameLink,
  type GameLink,
} from '../lib/gameLinksClient';
import { createGameLinksStore } from '../lib/gameLinksStore';
import { fetchNflState } from '../lib/nflState';

interface GameLinksContextValue {
  /** False when `GET /game-links` 404s because the routes are not deployed yet. */
  available: boolean;
  get(gameId: string): GameLink | null;
  save(gameId: string, url: string): Promise<GameLink>;
  remove(gameId: string): Promise<void>;
  refetch(): Promise<void>;
}

const GameLinksContext = createContext<GameLinksContextValue | undefined>(undefined);

/** This week's saved stream URLs. Loads on mount and whenever the app comes to the foreground. */
export function GameLinksProvider({ children }: PropsWithChildren) {
  const store = useMemo(
    () =>
      createGameLinksStore({
        currentWeek: async () => (await fetchNflState()).week,
        fetch: fetchGameLinks,
        save: saveGameLink,
        remove: deleteGameLink,
      }),
    [],
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useEffect(() => {
    void store.refetch();

    const onAppState = (status: AppStateStatus) => {
      if (status === 'active') void store.refetch();
    };
    const subscription = AppState.addEventListener('change', onAppState);

    const onVisible = () => {
      if (globalThis.document?.visibilityState === 'visible') void store.refetch();
    };
    globalThis.document?.addEventListener('visibilitychange', onVisible);

    return () => {
      subscription.remove();
      globalThis.document?.removeEventListener('visibilitychange', onVisible);
    };
  }, [store]);

  const value = useMemo<GameLinksContextValue>(
    () => ({
      available: snapshot.available,
      get: (gameId: string) => snapshot.links.get(gameId) ?? null,
      save: store.save,
      remove: store.remove,
      refetch: store.refetch,
    }),
    [snapshot, store],
  );

  return <GameLinksContext.Provider value={value}>{children}</GameLinksContext.Provider>;
}

export function useGameLinks(): GameLinksContextValue {
  const value = useContext(GameLinksContext);
  if (!value) {
    throw new Error('useGameLinks must be used within GameLinksProvider');
  }
  return value;
}
