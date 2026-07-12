import { createClient } from '@supabase/supabase-js';
import type { Env } from '../env.js';
import type { Database } from './database.types.js';

/**
 * Server-side client using the service role key — bypasses RLS, so every query in `routes/`
 * must filter by `request.user.id` explicitly (see `plugins/auth.ts`).
 */
export function createSupabaseServiceClient(env: Env) {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;
