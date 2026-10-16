import { describe, expect, it, vi } from 'vitest';

import type { GameLink } from './gameLinksClient';
import { createGameLinksStore, type GameLinksClient } from './gameLinksStore';

const LINK: GameLink = {
  game_id: 'game-1',
  url: 'https://www.primevideo.com/detail/test',
  host: 'www.primevideo.com',
  updated_at: '2026-10-16T01:00:00.000Z',
};

function client(overrides: Partial<GameLinksClient> = {}): GameLinksClient {
  return {
    currentWeek: async () => 6,
    fetch: async () => ({ week: 6, links: [] }),
    save: async () => LINK,
    remove: async () => undefined,
    ...overrides,
  };
}

describe('GameLinksProvider', () => {
  it('treats a 404 as unavailable and keeps the map empty', async () => {
    const store = createGameLinksStore(
      client({
        fetch: async () => {
          throw Object.assign(new Error('not found'), { status: 404 });
        },
      }),
    );

    await store.refetch();

    expect(store.getSnapshot().available).toBe(false);
    expect(store.get('game-1')).toBeNull();
    expect([...store.getSnapshot().links.keys()]).toEqual([]);
  });

  it('save puts the link in the map and remove clears it', async () => {
    const store = createGameLinksStore(client());

    await expect(store.save('game-1', LINK.url)).resolves.toEqual(LINK);
    expect(store.get('game-1')).toEqual(LINK);

    await store.remove('game-1');
    expect(store.get('game-1')).toBeNull();
  });

  it('warns and clears the map on any other load error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = createGameLinksStore(
      client({
        fetch: async () => ({ week: 6, links: [LINK] }),
      }),
    );
    await store.refetch();
    expect(store.getSnapshot().available).toBe(true);

    const failing = createGameLinksStore(
      client({
        fetch: async () => {
          throw new Error('offline');
        },
      }),
    );
    await failing.refetch();

    expect(failing.getSnapshot().available).toBe(false);
    expect(failing.getSnapshot().links.size).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
