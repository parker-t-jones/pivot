import { describe, expect, it, vi } from 'vitest';
import { InMemoryRealtimeBus, realtimeGameChannel, realtimeUserChannel } from './realtimeBus.js';

describe('realtimeUserChannel / realtimeGameChannel', () => {
  it('namespaces channels per Phase 4 fan-out design', () => {
    expect(realtimeUserChannel('user-1')).toBe('realtime:user:user-1');
    expect(realtimeGameChannel('game-1')).toBe('realtime:game:game-1');
  });
});

describe('InMemoryRealtimeBus', () => {
  it('records every publish', async () => {
    const bus = new InMemoryRealtimeBus();
    await bus.publish('realtime:user:user-1', { hello: 'world' });
    expect(bus.published).toEqual([{ channel: 'realtime:user:user-1', message: { hello: 'world' } }]);
  });

  it('delivers to an exact-channel subscriber', async () => {
    const bus = new InMemoryRealtimeBus();
    const handler = vi.fn();
    await bus.subscribe('realtime:user:user-1', handler);

    await bus.publish('realtime:user:user-1', { a: 1 });
    await bus.publish('realtime:user:user-2', { a: 2 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('realtime:user:user-1', { a: 1 });
  });

  it('delivers to a pattern subscriber for any matching channel', async () => {
    const bus = new InMemoryRealtimeBus();
    const handler = vi.fn();
    await bus.psubscribe('realtime:user:*', handler);

    await bus.publish('realtime:user:user-1', { a: 1 });
    await bus.publish('realtime:game:game-1', { a: 2 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('realtime:user:user-1', { a: 1 });
  });

  it('stops delivering after unsubscribe', async () => {
    const bus = new InMemoryRealtimeBus();
    const handler = vi.fn();
    const sub = await bus.subscribe('realtime:user:user-1', handler);
    await sub.unsubscribe();

    await bus.publish('realtime:user:user-1', { a: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('stops delivering to a pattern subscriber after unsubscribe', async () => {
    const bus = new InMemoryRealtimeBus();
    const handler = vi.fn();
    const sub = await bus.psubscribe('realtime:game:*', handler);
    await sub.unsubscribe();

    await bus.publish('realtime:game:game-1', { a: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('supports multiple independent handlers on the same channel', async () => {
    const bus = new InMemoryRealtimeBus();
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    await bus.subscribe('realtime:user:user-1', handlerA);
    const subB = await bus.subscribe('realtime:user:user-1', handlerB);

    await subB.unsubscribe();
    await bus.publish('realtime:user:user-1', { a: 1 });

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).not.toHaveBeenCalled();
  });
});
