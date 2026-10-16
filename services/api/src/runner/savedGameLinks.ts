import type { SavedGameLinkLookup } from '@pivot/dispatcher';

import type { SupabaseServiceClient } from '../lib/supabase.js';

/** Service-role read of `user_game_links`. One row per user and game. */
export class SupabaseSavedGameLinkLookup implements SavedGameLinkLookup {
  constructor(private readonly client: SupabaseServiceClient) {}

  async urlFor(userId: string, gameId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('user_game_links')
      .select('url')
      .eq('user_id', userId)
      .eq('game_id', gameId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.url ?? null;
  }
}
