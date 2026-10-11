import { decidePushDelivery } from '@pivot/dispatcher';
import { describe, expect, it } from 'vitest';
import type { SupabaseServiceClient } from './supabase.js';
import { PRIMARY_WATCH_MS } from './primaryWatch.js';
import { SupabaseUserDirectory } from '../runner/supabaseCatalogs.js';

const USER = 'user-1';
const GAME = '11111111-1111-4111-8111-111111111111';

interface SessionRow {
  primary_game_id: string | null;
  primary_source: string | null;
  primary_priority_score: number | null;
  last_updated_at: string;
}

/**
 * Enough of the query builder for `getViewingSession`: one session row, one game status,
 * and an update that clears the primary in place.
 */
class WatchFake {
  status: string;
  readonly session: SessionRow;

  constructor(setAtIso: string, status: string) {
    this.status = status;
    this.session = {
      primary_game_id: GAME,
      primary_source: 'deeplink',
      primary_priority_score: 5,
      last_updated_at: setAtIso,
    };
  }

  from(table: string) {
    if (table === 'games') {
      const status = this.status;
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { status }, error: null }),
          }),
        }),
      };
    }
    if (table === 'viewing_sessions') {
      const session = this.session;
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: session, error: null }),
          }),
        }),
        update: (patch: Partial<SessionRow>) => {
          const filters: [string, unknown][] = [];
          const apply = async () => {
            const matches = filters.every(([column, value]) => {
              if (column === 'user_id') return value === USER;
              return session[column as keyof SessionRow] === value;
            });
            if (matches) Object.assign(session, patch);
            return { error: null };
          };
          const builder = {
            eq(column: string, value: unknown) {
              filters.push([column, value]);
              return builder;
            },
            then<TResult1 = { error: null }, TResult2 = never>(
              onfulfilled?: (value: { error: null }) => TResult1 | PromiseLike<TResult1>,
              onrejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>,
            ) {
              return apply().then(onfulfilled, onrejected);
            },
          };
          return builder;
        },
      };
    }
    throw new Error(`Unexpected table in test fixture: ${table}`);
  }
}

function directory(setAtMs: number, status = 'in_progress'): { directory: SupabaseUserDirectory; fake: WatchFake } {
  const fake = new WatchFake(new Date(setAtMs).toISOString(), status);
  return {
    fake,
    directory: new SupabaseUserDirectory(fake as unknown as SupabaseServiceClient),
  };
}

describe('SupabaseUserDirectory primary watch', () => {
  it('returns the primary on a read within 4 hours', async () => {
    const { directory: users, fake } = directory(Date.now() - PRIMARY_WATCH_MS + 1000);
    const session = await users.getViewingSession(USER);
    expect(session?.primaryGameId).toBe(GAME);
    expect(fake.session.primary_game_id).toBe(GAME);
  });

  it('reads as none and clears the row when the game is final', async () => {
    const { directory: users, fake } = directory(Date.now() - 60_000, 'final');
    const session = await users.getViewingSession(USER);
    expect(session).toEqual({ primaryGameId: null, primaryPriorityScore: null });
    expect(fake.session.primary_game_id).toBeNull();
    expect(fake.session.primary_source).toBeNull();
    expect(fake.session.primary_priority_score).toBeNull();
  });

  it('reads as none 4 hours and 1 second after the primary was set', async () => {
    const { directory: users, fake } = directory(Date.now() - PRIMARY_WATCH_MS - 1000);
    const session = await users.getViewingSession(USER);
    expect(session?.primaryGameId).toBeNull();
    expect(fake.session.primary_game_id).toBeNull();
  });

  it('does not skip a push for that game after the watch expires', async () => {
    const { directory: users } = directory(Date.now() - PRIMARY_WATCH_MS - 1000);
    const session = await users.getViewingSession(USER);
    expect(
      decidePushDelivery({
        connected: true,
        primaryGameId: session?.primaryGameId ?? null,
        gameId: GAME,
        hasToken: true,
      }),
    ).toBe('sent');
  });
});
