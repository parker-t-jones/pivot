import type { WebPushSubscription, WebPushSubscriptionStore } from '@pivot/dispatcher';

import type { SupabaseServiceClient } from '../lib/supabase.js';

export class SupabaseWebPushSubscriptionStore implements WebPushSubscriptionStore {
  constructor(private readonly client: SupabaseServiceClient) {}

  async listForUser(userId: string): Promise<WebPushSubscription[]> {
    const { data, error } = await this.client
      .from('web_push_subscriptions')
      .select('endpoint, device_id, p256dh, auth')
      .eq('user_id', userId);
    if (error) throw new Error(`web push subscription lookup failed: ${error.message}`);
    return (data ?? []).map((row) => ({
      endpoint: row.endpoint,
      deviceId: row.device_id,
      p256dh: row.p256dh,
      auth: row.auth,
    }));
  }

  async recordSuccess(endpoint: string, atMs: number): Promise<void> {
    const { error } = await this.client
      .from('web_push_subscriptions')
      .update({ last_success_at: new Date(atMs).toISOString() })
      .eq('endpoint', endpoint);
    if (error) throw new Error(`web push success write failed: ${error.message}`);
  }

  async deleteEndpoint(endpoint: string): Promise<void> {
    const { error } = await this.client.from('web_push_subscriptions').delete().eq('endpoint', endpoint);
    if (error) throw new Error(`web push subscription delete failed: ${error.message}`);
  }
}
