/**
 * Idempotent App Review account. Re-running restores a known state:
 *  - auth user demo@pivot-sports.app, email confirmed, password from DEMO_USER_PASSWORD
 *  - public.users.is_demo = true
 *  - preferences cleared to {} (API defaults)
 *  - user_app_presence replaced with directv only
 *  - this user's leagues and stakes removed (lineup slots cascade from leagues)
 *
 * Does not insert games, game_airings, leagues, lineup slots, or stakes.
 * The live slate is served by the API from fixtures when is_demo is true.
 *
 * Usage: `pnpm seed:demo-user` from the repo root.
 * Remote hosts require `--allow-remote`.
 */
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { bootstrapSeedScript, RemoteSafetyError } from './remoteSafety.js';

const DEMO_EMAIL = 'demo@pivot-sports.app';

function demoPassword(): string {
  const password = process.env['DEMO_USER_PASSWORD'];
  if (!password || password.length === 0) {
    throw new Error('DEMO_USER_PASSWORD is required. It is not stored in the repo.');
  }
  return password;
}

export async function seedDemoUser(): Promise<void> {
  const supabaseUrl = process.env['SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Set them in services/api/.env.',
    );
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const password = demoPassword();

  console.log(`Looking up ${DEMO_EMAIL}...`);
  const { data: existingUser, error: existingUserError } = await supabase
    .from('users')
    .select('id')
    .eq('email', DEMO_EMAIL)
    .maybeSingle();
  if (existingUserError) throw existingUserError;

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
    console.log(`Found ${userId}. Resetting password and confirming email...`);
    const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    });
    if (updateError) throw updateError;
  } else {
    console.log('Creating the demo user...');
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: DEMO_EMAIL,
      password,
      email_confirm: true,
    });
    if (createError) throw createError;
    if (!created.user) throw new Error('createUser succeeded but returned no user.');
    userId = created.user.id;
  }

  const { error: userError } = await supabase
    .from('users')
    .update({ is_demo: true, preferences: {} })
    .eq('id', userId);
  if (userError) throw userError;

  const { error: stakesError } = await supabase.from('stakes').delete().eq('user_id', userId);
  if (stakesError) throw stakesError;

  const { error: leaguesError } = await supabase.from('leagues').delete().eq('user_id', userId);
  if (leaguesError) throw leaguesError;

  const { error: presenceDeleteError } = await supabase
    .from('user_app_presence')
    .delete()
    .eq('user_id', userId);
  if (presenceDeleteError) throw presenceDeleteError;

  const { error: presenceError } = await supabase.from('user_app_presence').insert({
    user_id: userId,
    service: 'directv',
    has_subscription: true,
  });
  if (presenceError) throw presenceError;

  console.log(`\nDemo account ready: ${DEMO_EMAIL}`);
  console.log('is_demo=true, services=directv, preferences=defaults, no leagues or stakes.');
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    bootstrapSeedScript({ argv: process.argv.slice(2), scriptName: 'seed:demo-user' });
    seedDemoUser().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = error instanceof RemoteSafetyError ? error.exitCode : 1;
  }
}
