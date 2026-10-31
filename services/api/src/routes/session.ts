import { ACTIVE_USER_TTL_MS } from '@pivot/dispatcher';
import { computeFlagState } from '@pivot/engine';
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { userIsDemo } from '../lib/demoAccount.js';
import { isDemoGameId } from '../lib/demoFixture.js';
import { ApiError } from '../lib/errors.js';
import { getCurrentNflState } from '../lib/nfl-state.js';
import { resolvePrimaryWatch } from '../lib/primaryWatch.js';
import { requireUser } from '../plugins/auth.js';
import '../plugins/services.js';

/** Section 9's `PUT /session/primary` body only allows the three client-settable sources —
 *  `'embedded'` is a valid DB value (Phase 2 partnership rollout) but isn't set through this
 *  endpoint yet, so it's deliberately excluded from client input validation. */
const PRIMARY_SOURCES = ['deeplink', 'airplay', 'chromecast'] as const;

const SESSION_COLUMNS =
  'primary_game_id, primary_source, primary_priority_score, thumbnail_game_ids, started_at, last_updated_at';

interface ViewingSessionRow {
  primary_game_id: string | null;
  primary_source: string | null;
  primary_priority_score: number | null;
  thumbnail_game_ids: string[];
  started_at: string;
  last_updated_at: string;
}

/** No row yet (never started a session) renders as an all-null/empty session rather than a 404 —
 *  "current viewing session" is naturally empty before the app's first foreground, not missing. */
function sessionResponse(row: ViewingSessionRow | null) {
  if (!row) {
    return {
      primary_game_id: null,
      primary_source: null,
      primary_priority_score: null,
      thumbnail_game_ids: [] as string[],
      started_at: null,
      last_updated_at: null,
    };
  }
  return {
    primary_game_id: row.primary_game_id,
    primary_source: row.primary_source,
    primary_priority_score: row.primary_priority_score,
    thumbnail_game_ids: row.thumbnail_game_ids,
    started_at: row.started_at,
    last_updated_at: row.last_updated_at,
  };
}

async function gameStatus(fastify: FastifyInstance, gameId: string): Promise<string | null> {
  const { data, error } = await fastify.supabase
    .from('games')
    .select('status')
    .eq('id', gameId)
    .maybeSingle();
  if (error) throw error;
  return data?.status ?? null;
}

async function clearStoredPrimary(
  fastify: FastifyInstance,
  row: { userId: string; primaryGameId: string; setAtIso: string },
): Promise<ViewingSessionRow | null> {
  const { data, error } = await fastify.supabase
    .from('viewing_sessions')
    .update({
      primary_game_id: null,
      primary_source: null,
      primary_priority_score: null,
      last_updated_at: new Date().toISOString(),
    })
    .eq('user_id', row.userId)
    .eq('primary_game_id', row.primaryGameId)
    .eq('last_updated_at', row.setAtIso)
    .select(SESSION_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Reads the session and, when the Switch primary has expired, clears that row before returning. */
async function loadSession(
  fastify: FastifyInstance,
  userId: string,
): Promise<ViewingSessionRow | null> {
  const { data, error } = await fastify.supabase
    .from('viewing_sessions')
    .select(SESSION_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  let cleared: ViewingSessionRow | null = null;
  const resolved = await resolvePrimaryWatch({
    userId,
    primaryGameId: data.primary_game_id,
    primaryPriorityScore: data.primary_priority_score,
    setAtIso: data.last_updated_at,
    nowMs: Date.now(),
    gameStatus: (gameId) => gameStatus(fastify, gameId),
    clear: async (row) => {
      cleared = await clearStoredPrimary(fastify, row);
    },
  });
  if (!resolved.expired) return data;
  return (
    cleared ?? {
      ...data,
      primary_game_id: null,
      primary_source: null,
      primary_priority_score: null,
    }
  );
}

/** Fresh `computeFlagState` priority for the game being set as primary (same discipline as
 *  `/flags/current` — never trust stale data). Missing lineup or no live `GameState` yet (game
 *  hasn't kicked off) both mean "nothing to flag," so `0` rather than an error. */
async function computeCurrentPriorityScore(
  fastify: FastifyInstance,
  userId: string,
  gameId: string,
): Promise<number> {
  const nflState = await getCurrentNflState(fastify.lineupCache);
  const lineup = await fastify.lineupCache.getLineupCache(userId, nflState.week);
  if (!lineup) return 0;

  const gameState = await fastify.gameStateStore.getGameState(gameId);
  if (!gameState) return 0;

  return computeFlagState(lineup, gameState).priorityScore;
}

const sessionRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/session', async (request) => {
    const user = requireUser(request);
    return sessionResponse(await loadSession(fastify, user.id));
  });

  /**
   * "Begin session (app foreground)." One row per user (Section 7), upserted rather than reset —
   * touches `started_at` without clobbering an existing `primary_game_id` (e.g. the user
   * backgrounds/foregrounds the app while AirPlay is still mirroring the same game).
   * `last_updated_at` stays at the Switch set time while a primary survives, so a foreground does
   * not extend the 4-hour watch. An already-expired primary is cleared first.
   */
  fastify.post('/session/start', async (request) => {
    const user = requireUser(request);
    const current = await loadSession(fastify, user.id);
    const now = new Date().toISOString();

    const { data, error } = await fastify.supabase
      .from('viewing_sessions')
      .upsert(
        {
          user_id: user.id,
          started_at: now,
          ...(current?.primary_game_id ? {} : { last_updated_at: now }),
        },
        { onConflict: 'user_id' },
      )
      .select(SESSION_COLUMNS)
      .single();
    if (error) throw error;
    return sessionResponse(data);
  });

  fastify.put(
    '/session/primary',
    {
      schema: {
        body: z.object({
          game_id: z.string().uuid(),
          source: z.enum(PRIMARY_SOURCES),
        }),
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { game_id, source } = request.body;
      if (isDemoGameId(game_id) && (await userIsDemo(fastify.supabase, user.id))) {
        const now = new Date().toISOString();
        return {
          primary_game_id: game_id,
          primary_source: source,
          primary_priority_score: null,
          thumbnail_game_ids: [] as string[],
          started_at: now,
          last_updated_at: now,
        };
      }

      const { data: game, error: gameError } = await fastify.supabase
        .from('games')
        .select('id')
        .eq('id', game_id)
        .maybeSingle();
      if (gameError) throw gameError;
      if (!game) {
        throw new ApiError(404, 'game_not_found', 'No game exists with that id.');
      }

      const priorityScore = await computeCurrentPriorityScore(fastify, user.id, game_id);

      const { data, error } = await fastify.supabase
        .from('viewing_sessions')
        .upsert(
          {
            user_id: user.id,
            primary_game_id: game_id,
            primary_source: source,
            primary_priority_score: priorityScore,
            last_updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        )
        .select(SESSION_COLUMNS)
        .single();
      if (error) throw error;

      let cleared: ViewingSessionRow | null = null;
      const resolved = await resolvePrimaryWatch({
        userId: user.id,
        primaryGameId: data.primary_game_id,
        primaryPriorityScore: data.primary_priority_score,
        setAtIso: data.last_updated_at,
        nowMs: Date.now(),
        gameStatus: (id) => gameStatus(fastify, id),
        clear: async (row) => {
          cleared = await clearStoredPrimary(fastify, row);
        },
      });
      if (resolved.expired) return sessionResponse(cleared);
      return sessionResponse(data);
    },
  );

  fastify.delete('/session/primary', async (request) => {
    const user = requireUser(request);

    const { data, error } = await fastify.supabase
      .from('viewing_sessions')
      .update({
        primary_game_id: null,
        primary_source: null,
        primary_priority_score: null,
        last_updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)
      .select(SESSION_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    return sessionResponse(data);
  });

  /**
   * Keep-alive every 30s (Section 9). Only refreshes Redis `active_users` (Section 7's 5-minute
   * liveness window that `isStillRelevant` reads) — deliberately does not touch `viewing_sessions`
   * in Postgres. "Key design notes": WebSocket `ping` is the separate, stronger liveness signal for
   * connected clients; this is the REST equivalent for a backgrounded-socket/polling client.
   */
  fastify.post('/session/heartbeat', async (request) => {
    const user = requireUser(request);
    // No device id on this route. The bare member is device legacy-ios, same as a TestFlight socket.
    // The app does not call heartbeat; the socket is what marks a phone present.
    await fastify.gameStateStore.markUserActive(user.id, ACTIVE_USER_TTL_MS);
    return { active_until: Date.now() + ACTIVE_USER_TTL_MS };
  });
};

export default sessionRoutes;
