import { TRIGGER_KIND, type Trigger, type TriggerCode } from '@pivot/engine';
import type { SupabaseServiceClient } from './supabase.js';

const FIRED_TTL_SEC = 24 * 60 * 60;

export interface FireClaimRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
}

export interface FireClaimContext {
  gameId: string;
  supabase: SupabaseServiceClient;
  redis: FireClaimRedis;
}

function firedKey(stakeId: string, code: string): string {
  return `stake_fired:${stakeId}:${code}`;
}

/**
 * Claims the only fire for this stake and code. A set Redis key skips the database.
 * A database error fails closed so a push cannot be sent twice.
 */
export async function claimFirstFire(
  stakeId: string,
  code: TriggerCode,
  ctx: FireClaimContext,
): Promise<boolean> {
  const key = firedKey(stakeId, code);
  if ((await ctx.redis.get(key)) !== null) return false;

  const { data, error } = await ctx.supabase
    .from('stake_trigger_log')
    .upsert(
      {
        stake_id: stakeId,
        code,
        drive_key: ctx.gameId,
        fired_at: new Date().toISOString(),
        kind: TRIGGER_KIND[code],
      },
      { onConflict: 'stake_id,code', ignoreDuplicates: true },
    )
    .select('id');
  if (error) {
    console.error(
      `[stakes] fire-claim failed stake=${stakeId.slice(0, 8)} code=${code} err=${error.message}`,
    );
    return false;
  }

  await ctx.redis.set(key, '1', FIRED_TTL_SEC);
  return (data ?? []).length > 0;
}

/** Keeps the triggers from one play whose claim succeeded, in the same order. */
export async function firstFires(
  triggers: readonly Trigger[],
  claim: (trigger: Trigger) => Promise<boolean>,
): Promise<Trigger[]> {
  const fired: Trigger[] = [];
  for (const trigger of triggers) {
    if (await claim(trigger)) fired.push(trigger);
  }
  return fired;
}
