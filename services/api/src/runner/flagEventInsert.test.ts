import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { afterAll, describe, expect, it } from 'vitest';
import type { FlagEvent, FlagState } from '@pivot/shared';
import {
  CapturingPushNotifier,
  InMemoryBroadcastCatalog,
  InMemoryGameCatalog,
  InMemoryGameStateStore,
  InMemoryPlayerCatalog,
  InMemoryRateLimitStore,
  InMemoryRealtimeBus,
  InMemoryUserDirectory,
  deliverFlagEvent,
  type DeliveryDeps,
  type DispatchUser,
} from '@pivot/dispatcher';
import type { Database } from '../lib/database.types.js';
import { SupabaseFlagEventPersistence } from './supabaseFlagEventPersistence.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIXTURE_EMAIL = 'p0-6-flag-insert@localhost.test';
const FIXTURE_PASSWORD = 'p0-6-local-only';
const PLAY_ID = 'p0.6-fixture-play';
const GAME_EXTERNAL_ID = 'p0.6-flag-fixture';

const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
loadEnv({ path: envFile, quiet: true });

const supabaseUrl = process.env['SUPABASE_URL'];
const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

const localReady = Boolean(supabaseUrl && serviceRoleKey && isLoopback(supabaseUrl));

function flagState(gameId: string): FlagState {
  return {
    gameId,
    flagged: true,
    priorityScore: 10,
    reasons: [{ type: 'offense_active', triggeringPlayerIds: ['p1'] }],
    computedAt: 1_700_000_000_000,
  };
}

function flagEvent(userId: string, gameId: string, id: string): FlagEvent {
  return {
    id,
    userId,
    gameId,
    type: 'flag_added',
    oldState: null,
    newState: flagState(gameId),
    scheduledFireAt: 1_700_000_060_000,
  };
}

async function ensureTeam(
  client: SupabaseClient<Database>,
  abbreviation: string,
  name: string,
): Promise<string> {
  const existing = await client
    .from('teams')
    .select('id')
    .eq('abbreviation', abbreviation)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.id;

  const inserted = await client
    .from('teams')
    .insert({
      abbreviation,
      name,
      city: 'Fixture',
      conference: 'AFC',
      division: 'East',
      primary_color: '#000000',
      secondary_color: '#FFFFFF',
    })
    .select('id')
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data.id;
}

async function ensureUser(client: SupabaseClient<Database>): Promise<string> {
  const existing = await client.from('users').select('id').eq('email', FIXTURE_EMAIL).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.id;

  const created = await client.auth.admin.createUser({
    email: FIXTURE_EMAIL,
    password: FIXTURE_PASSWORD,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const userId = created.data.user?.id;
  if (!userId) throw new Error('createUser returned no user id');

  const row = await client.from('users').select('id').eq('id', userId).maybeSingle();
  if (row.error) throw row.error;
  if (!row.data) throw new Error('auth user was created without a public.users row');
  return userId;
}

async function ensureGame(
  client: SupabaseClient<Database>,
  homeTeamId: string,
  awayTeamId: string,
): Promise<string> {
  const existing = await client
    .from('games')
    .select('id')
    .eq('sportradar_id', GAME_EXTERNAL_ID)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.id;

  const inserted = await client
    .from('games')
    .insert({
      sportradar_id: GAME_EXTERNAL_ID,
      season_year: 2026,
      season_type: 'regular',
      week: 1,
      scheduled_start: '2026-09-13T17:00:00.000Z',
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      status: 'scheduled',
    })
    .select('id')
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data.id;
}

describe.skipIf(!localReady)('local flag_events insert', () => {
  // A leftover past-kickoff `scheduled` game with no ESPN id trips the runner's reconcile.
  afterAll(async () => {
    if (!supabaseUrl || !serviceRoleKey || !isLoopback(supabaseUrl)) return;
    const client = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const game = await client
      .from('games')
      .select('id')
      .eq('sportradar_id', GAME_EXTERNAL_ID)
      .maybeSingle();
    if (game.error) throw game.error;
    if (!game.data) return;
    const events = await client.from('flag_events').delete().eq('game_id', game.data.id);
    if (events.error) throw events.error;
    const deleted = await client.from('games').delete().eq('id', game.data.id);
    if (deleted.error) throw deleted.error;
  });

  it('inserts one uuid row for a play and does not notify on the same key again', async () => {
    if (!supabaseUrl || !serviceRoleKey || !isLoopback(supabaseUrl)) {
      throw new Error('refusing flag_events insert against a non-local Supabase URL');
    }

    const client = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const userId = await ensureUser(client);
    const homeTeamId = await ensureTeam(client, 'Z6H', 'Fixture Home');
    const awayTeamId = await ensureTeam(client, 'Z6A', 'Fixture Away');
    const gameId = await ensureGame(client, homeTeamId, awayTeamId);

    const cleared = await client
      .from('flag_events')
      .delete()
      .eq('user_id', userId)
      .eq('game_id', gameId)
      .eq('triggering_play_id', PLAY_ID);
    if (cleared.error) throw cleared.error;

    const persistence = new SupabaseFlagEventPersistence(client);
    const pushNotifier = new CapturingPushNotifier();
    const realtimeBus = new InMemoryRealtimeBus();
    const user: DispatchUser = {
      id: userId,
      subscriptionTier: 'free',
      preferences: {
        notificationMode: 'all',
        quietHours: { enabled: false, startHour: 22, endHour: 8, timezone: 'America/New_York' },
        autoSwitch: false,
        watchOpponent: false,
        watchedLeagueIds: [],
      },
      expoPushToken: 'ExponentPushToken[p0-6-local]',
    };
    const deps: DeliveryDeps = {
      gameStateStore: new InMemoryGameStateStore(),
      gameCatalog: new InMemoryGameCatalog(),
      playerCatalog: new InMemoryPlayerCatalog(),
      broadcastCatalog: new InMemoryBroadcastCatalog(),
      userDirectory: new InMemoryUserDirectory(),
      persistence,
      realtimeBus,
      rateLimitStore: new InMemoryRateLimitStore(),
      pushNotifier,
      clock: () => 1_700_000_061_500,
    };

    const first = await deliverFlagEvent(
      deps,
      flagEvent(userId, gameId, 'engine-id-1'),
      user,
      PLAY_ID,
    );
    const second = await deliverFlagEvent(
      deps,
      flagEvent(userId, gameId, 'engine-id-2'),
      user,
      PLAY_ID,
    );

    const rows = await client
      .from('flag_events')
      .select('id, triggering_play_id')
      .eq('user_id', userId)
      .eq('game_id', gameId)
      .eq('triggering_play_id', PLAY_ID);
    if (rows.error) throw rows.error;

    expect(first).toBe('inserted');
    expect(second).toBe('duplicate');
    expect(rows.data).toHaveLength(1);
    expect(rows.data[0]?.id).toMatch(UUID_RE);
    expect(rows.data[0]?.triggering_play_id).toBe(PLAY_ID);
    expect(realtimeBus.published).toHaveLength(1);
    expect(pushNotifier.calls).toHaveLength(1);
    console.log(`flag_events.id ${rows.data[0]?.id}`);
  });
});
