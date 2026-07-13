import { describe, expect, it } from 'vitest';
import { InMemoryRealtimeBus } from './realtimeBus.js';
import { createRealtimeChannels } from './realtimeSubscriber.js';

describe('createRealtimeChannels', () => {
  it('returns a single InMemoryRealtimeBus serving both roles for cacheDriver=memory', () => {
    const channels = createRealtimeChannels({ cacheDriver: 'memory' });
    expect(channels.bus).toBeInstanceOf(InMemoryRealtimeBus);
    expect(channels.bus).toBe(channels.subscriber);
  });

  it('close() is a no-op for the in-memory pair', async () => {
    const channels = createRealtimeChannels({ cacheDriver: 'memory' });
    await expect(channels.close()).resolves.toBeUndefined();
  });

  it('throws for cacheDriver=redis without full Redis config', () => {
    expect(() => createRealtimeChannels({ cacheDriver: 'redis' })).toThrow(
      /UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, and UPSTASH_REDIS_TCP_URL/,
    );
    expect(() =>
      createRealtimeChannels({
        cacheDriver: 'redis',
        upstashRestUrl: 'https://example.upstash.io',
        upstashRestToken: 'token',
        // upstashTcpUrl missing
      }),
    ).toThrow(/UPSTASH_REDIS_TCP_URL/);
  });
});
