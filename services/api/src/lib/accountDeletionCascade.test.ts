import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { afterAll, describe, expect, it } from 'vitest';
import type { Database } from './database.types.js';

/**
 * Issue #33: `DELETE /me` (services/api/src/routes/me.ts) deletes only the `auth.users` row and
 * relies on `public.users.id REFERENCES auth.users (id) ON DELETE CASCADE`, plus every other
 * user-owned table's own `ON DELETE CASCADE` to `public.users`, to remove the rest. That route's
 * own comment lists `leagues`, `lineup_slots`, `flag_events`, `viewing_sessions`, and
 * `user_app_presence` — written before `stakes`, `stake_trigger_log`, `web_push_subscriptions`,
 * `user_game_links`, `stake_spent_slots`, and `pick_slips` existed. This test is the thing that
 * actually has to stay true: every table a privacy audit finds holding user data must empty out
 * when the user is deleted, regardless of whether a comment mentions it. A future table that adds
 * `user_id` without `ON DELETE CASCADE` fails this test, not just a stale comment.
 */

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

const FIXTURE_EMAIL = 'p33-account-deletion-cascade@localhost.test';
const FIXTURE_PASSWORD = 'p33-local-only';
const GAME_EXTERNAL_ID = 'p33-deletion-fixture';
const HOME_ABBR = 'Z9H';
const AWAY_ABBR = 'Z9A';

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

async function ensurePlayer(client: SupabaseClient<Database>, teamId: string): Promise<string> {
  const existing = await client
    .from('players')
    .select('id')
    .eq('sportradar_id', GAME_EXTERNAL_ID)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.id;

  const inserted = await client
    .from('players')
    .insert({
      sportradar_id: GAME_EXTERNAL_ID,
      first_name: 'Fixture',
      last_name: 'Player',
      position: 'WR',
      team_id: teamId,
    })
    .select('id')
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data.id;
}

/** Creates (or reuses) the fixture auth user and returns its id, deleting any stale one first so
 *  each run starts from zero rows in every table under test. */
async function freshUser(client: SupabaseClient<Database>): Promise<string> {
  const existing = await client.from('users').select('id').eq('email', FIXTURE_EMAIL).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    const deleted = await client.auth.admin.deleteUser(existing.data.id);
    if (deleted.error) throw deleted.error;
  }

  const created = await client.auth.admin.createUser({
    email: FIXTURE_EMAIL,
    password: FIXTURE_PASSWORD,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const userId = created.data.user?.id;
  if (!userId) throw new Error('createUser returned no user id');
  return userId;
}

describe.skipIf(!localReady)('account deletion cascades through every user-data table', () => {
  afterAll(async () => {
    if (!supabaseUrl || !serviceRoleKey || !isLoopback(supabaseUrl)) return;
    const client = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const existing = await client
      .from('users')
      .select('id')
      .eq('email', FIXTURE_EMAIL)
      .maybeSingle();
    if (existing.data) await client.auth.admin.deleteUser(existing.data.id);
  });

  it('removes leagues, lineup_slots, flag_events, viewing_sessions, user_app_presence, stakes, stake_trigger_log, web_push_subscriptions, user_game_links, stake_spent_slots, and pick_slips', async () => {
    if (!supabaseUrl || !serviceRoleKey || !isLoopback(supabaseUrl)) {
      throw new Error('refusing to run against a non-local Supabase URL');
    }

    const client = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const userId = await freshUser(client);
    const homeTeamId = await ensureTeam(client, HOME_ABBR, 'Fixture Home');
    const awayTeamId = await ensureTeam(client, AWAY_ABBR, 'Fixture Away');
    const gameId = await ensureGame(client, homeTeamId, awayTeamId);
    const playerId = await ensurePlayer(client, homeTeamId);

    const league = await client
      .from('leagues')
      .insert({
        user_id: userId,
        platform: 'manual',
        name: 'Fixture League',
        season_year: 2026,
      })
      .select('id')
      .single();
    if (league.error) throw league.error;
    const leagueId = league.data.id;

    const lineupSlot = await client.from('lineup_slots').insert({
      league_id: leagueId,
      week: 1,
      player_id: playerId,
      slot_type: 'starter',
      position_in_lineup: 'WR',
    });
    if (lineupSlot.error) throw lineupSlot.error;

    const flagEvent = await client.from('flag_events').insert({
      user_id: userId,
      game_id: gameId,
      event_type: 'flag_added',
      priority_score: 1,
      reasons: [],
      fired_at: new Date().toISOString(),
    });
    if (flagEvent.error) throw flagEvent.error;

    const viewingSession = await client.from('viewing_sessions').insert({
      user_id: userId,
      primary_game_id: gameId,
    });
    if (viewingSession.error) throw viewingSession.error;

    const presence = await client.from('user_app_presence').insert({
      user_id: userId,
      service: 'youtube_tv',
      has_subscription: true,
    });
    if (presence.error) throw presence.error;

    const stake = await client
      .from('stakes')
      .insert({
        user_id: userId,
        season: 2026,
        week: 1,
        game_id: GAME_EXTERNAL_ID,
        subject: { type: 'PLAYER', playerId },
        condition: { type: 'ROSTERED' },
        source: 'MANUAL',
      })
      .select('id')
      .single();
    if (stake.error) throw stake.error;
    const stakeId = stake.data.id;

    const triggerLog = await client.from('stake_trigger_log').insert({
      stake_id: stakeId,
      code: 'fixture',
      drive_key: 'fixture-drive',
      fired_at: new Date().toISOString(),
      kind: 'NUDGE',
    });
    if (triggerLog.error) throw triggerLog.error;

    const webPush = await client.from('web_push_subscriptions').insert({
      user_id: userId,
      device_id: '33333333-3333-4333-8333-333333333333',
      endpoint: 'https://push.example.test/p33-deletion-fixture',
      p256dh: 'p256-fixture',
      auth: 'auth-fixture',
    });
    if (webPush.error) throw webPush.error;

    const gameLink = await client.from('user_game_links').insert({
      user_id: userId,
      game_id: gameId,
      url: 'https://example.test/watch',
    });
    if (gameLink.error) throw gameLink.error;

    const spentSlot = await client.from('stake_spent_slots').insert({
      stake_id: '44444444-4444-4444-8444-444444444444',
      user_id: userId,
      season: 2026,
      week: 1,
      game_id: GAME_EXTERNAL_ID,
    });
    if (spentSlot.error) throw spentSlot.error;

    const pickSlip = await client
      .from('pick_slips')
      .insert({ user_id: userId, season: 2026, week: 1 })
      .select('id')
      .single();
    if (pickSlip.error) throw pickSlip.error;
    const pickSlipId = pickSlip.data.id;

    const deleted = await client.auth.admin.deleteUser(userId);
    if (deleted.error) throw deleted.error;

    async function expectEmpty(
      table: string,
      result: { data: unknown[] | null; error: unknown },
    ): Promise<void> {
      if (result.error) throw result.error;
      expect(result.data, `${table} row survived account deletion`).toEqual([]);
    }

    await expectEmpty('leagues', await client.from('leagues').select('id').eq('id', leagueId));
    await expectEmpty(
      'lineup_slots',
      await client.from('lineup_slots').select('id').eq('league_id', leagueId),
    );
    await expectEmpty(
      'flag_events',
      await client.from('flag_events').select('id').eq('user_id', userId),
    );
    await expectEmpty(
      'viewing_sessions',
      await client.from('viewing_sessions').select('user_id').eq('user_id', userId),
    );
    await expectEmpty(
      'user_app_presence',
      await client.from('user_app_presence').select('id').eq('user_id', userId),
    );
    await expectEmpty('stakes', await client.from('stakes').select('id').eq('id', stakeId));
    await expectEmpty(
      'stake_trigger_log',
      await client.from('stake_trigger_log').select('id').eq('stake_id', stakeId),
    );
    await expectEmpty(
      'web_push_subscriptions',
      await client.from('web_push_subscriptions').select('endpoint').eq('user_id', userId),
    );
    await expectEmpty(
      'user_game_links',
      await client.from('user_game_links').select('game_id').eq('user_id', userId),
    );
    await expectEmpty(
      'stake_spent_slots',
      await client.from('stake_spent_slots').select('stake_id').eq('user_id', userId),
    );
    await expectEmpty(
      'pick_slips',
      await client.from('pick_slips').select('id').eq('id', pickSlipId),
    );
  });
});
