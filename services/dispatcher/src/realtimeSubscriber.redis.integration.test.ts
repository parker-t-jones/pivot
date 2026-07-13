import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { RedisRealtimeBus } from './realtimeBus.js';
import { RedisRealtimeSubscriber } from './realtimeSubscriber.js';
import { Redis as UpstashRedis } from '@upstash/redis';

/*
 * Real-Redis pub/sub integration test (sprint decision #1/#2). Requires a TCP connection string in
 * addition to the REST credentials, since `PSUBSCRIBE`/`SUBSCRIBE` need a persistent connection the
 * REST client can't provide. Skips entirely — never required for the standard `pnpm test` suite.
 *
 * Run with:
 *   CACHE_DRIVER=redis UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... UPSTASH_REDIS_TCP_URL=... pnpm test
 */

const shouldRun =
  process.env['CACHE_DRIVER'] === 'redis' &&
  !!process.env['UPSTASH_REDIS_REST_URL'] &&
  !!process.env['UPSTASH_REDIS_REST_TOKEN'] &&
  !!process.env['UPSTASH_REDIS_TCP_URL'];

let subscriber: RedisRealtimeSubscriber | null = null;

afterAll(async () => {
  await subscriber?.close();
});

describe.skipIf(!shouldRun)('RedisRealtimeSubscriber (integration, real Redis)', () => {
  it('receives a message published over the REST client via a psubscribe pattern', async () => {
    const bus = new RedisRealtimeBus(
      new UpstashRedis({
        url: process.env['UPSTASH_REDIS_REST_URL'] as string,
        token: process.env['UPSTASH_REDIS_REST_TOKEN'] as string,
      }),
    );
    subscriber = new RedisRealtimeSubscriber(process.env['UPSTASH_REDIS_TCP_URL'] as string);

    const userId = `test-${randomUUID()}`;
    const channel = `realtime:user:${userId}`;

    let resolveReceived: (value: { channel: string; message: unknown }) => void;
    const received = new Promise<{ channel: string; message: unknown }>((resolve) => {
      resolveReceived = resolve;
    });
    await subscriber.psubscribe('realtime:user:*', (ch, message) =>
      resolveReceived({ channel: ch, message }),
    );

    await bus.publish(channel, { hello: 'world' });

    const result = await received;
    expect(result.channel).toBe(channel);
    expect(result.message).toEqual({ hello: 'world' });
  }, 10_000);
});
