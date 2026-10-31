import type { SupabaseServiceClient } from './supabase.js';
import { ApiError } from './errors.js';

export const DEMO_ACCOUNT_MESSAGE = 'This demo account is fixed so the live game stays in place.';

export function demoAccountFixed(): ApiError {
  return new ApiError(409, 'demo_account_fixed', DEMO_ACCOUNT_MESSAGE);
}

/** True only when this user's row has `is_demo`. Missing row or a failed read is not demo. */
export async function userIsDemo(
  supabase: SupabaseServiceClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('users')
    .select('is_demo')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.is_demo === true;
}

export async function rejectIfDemo(supabase: SupabaseServiceClient, userId: string): Promise<void> {
  if (await userIsDemo(supabase, userId)) throw demoAccountFixed();
}

/** Subscribed services only (`has_subscription = true`), same rule as `GET /games`. */
export async function loadSubscribedServices(
  supabase: SupabaseServiceClient,
  userId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('user_app_presence')
    .select('service, has_subscription')
    .eq('user_id', userId);
  if (error) throw error;
  return new Set((data ?? []).filter((row) => row.has_subscription).map((row) => row.service));
}
