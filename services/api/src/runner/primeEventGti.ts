import { loadPrimeGtis } from '../lib/primeEventGti.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';

/** Service-role read of one game's GTI at push-send time. */
export class SupabasePrimeGtiLookup {
  constructor(private readonly client: SupabaseServiceClient) {}

  async gtiFor(gameId: string): Promise<string | null> {
    const map = await loadPrimeGtis(this.client, [gameId]);
    return map.get(gameId) ?? null;
  }
}
