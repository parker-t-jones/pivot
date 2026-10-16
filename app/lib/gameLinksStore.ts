import type { GameLink, GameLinksResponse } from './gameLinksClient';

export interface GameLinksSnapshot {
  available: boolean;
  links: ReadonlyMap<string, GameLink>;
}

/** The fetches `GameLinksProvider` performs. Tests pass a fake. */
export interface GameLinksClient {
  currentWeek(): Promise<number>;
  fetch(week: number): Promise<GameLinksResponse>;
  save(gameId: string, url: string): Promise<GameLink>;
  remove(gameId: string): Promise<void>;
}

export interface GameLinksStore {
  getSnapshot(): GameLinksSnapshot;
  subscribe(listener: () => void): () => void;
  get(gameId: string): GameLink | null;
  refetch(): Promise<void>;
  save(gameId: string, url: string): Promise<GameLink>;
  remove(gameId: string): Promise<void>;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status: unknown }).status === 404
  );
}

/**
 * In-memory map of this week's saved links. A 404 means the routes are not deployed yet:
 * the map stays empty and `available` is false, so the app shows no editor. Any other
 * failure clears the map and warns, without an error UI.
 */
export function createGameLinksStore(client: GameLinksClient): GameLinksStore {
  let request = 0;
  let snapshot: GameLinksSnapshot = { available: false, links: new Map() };
  const listeners = new Set<() => void>();

  function publish(next: GameLinksSnapshot): void {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function replaceLinks(
    links: ReadonlyMap<string, GameLink>,
    available = snapshot.available,
  ): void {
    request += 1;
    publish({ available, links });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get(gameId) {
      return snapshot.links.get(gameId) ?? null;
    },
    async refetch() {
      const id = ++request;
      try {
        const week = await client.currentWeek();
        const body = await client.fetch(week);
        if (id !== request) return;
        publish({
          available: true,
          links: new Map(body.links.map((link) => [link.game_id, link])),
        });
      } catch (error) {
        if (id !== request) return;
        if (isNotFound(error)) {
          publish({ available: false, links: new Map() });
          return;
        }
        console.warn('[game-links] failed to load', error);
        publish({ available: snapshot.available, links: new Map() });
      }
    },
    async save(gameId, url) {
      const saved = await client.save(gameId, url);
      const links = new Map(snapshot.links);
      links.set(saved.game_id, saved);
      replaceLinks(links);
      return saved;
    },
    async remove(gameId) {
      await client.remove(gameId);
      const links = new Map(snapshot.links);
      links.delete(gameId);
      replaceLinks(links);
    },
  };
}
