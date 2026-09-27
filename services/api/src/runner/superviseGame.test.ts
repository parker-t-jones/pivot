import { describe, expect, it } from 'vitest';
import { superviseGame } from './superviseGame.js';

describe('superviseGame', () => {
  it("does not stop another game when one game's loop throws", async () => {
    const logs: string[] = [];
    const handled: string[] = [];
    const controller = new AbortController();

    const healthy = superviseGame({
      eventId: 'espn-b',
      signal: controller.signal,
      run: async () => {
        handled.push('espn-b');
      },
    });
    const failing = superviseGame({
      eventId: 'espn-a',
      signal: controller.signal,
      log: (line) => logs.push(line),
      delay: () => {
        controller.abort();
        return Promise.resolve();
      },
      run: () => {
        throw new Error('boom');
      },
    });

    await Promise.all([failing, healthy]);
    expect(handled).toEqual(['espn-b']);
    expect(logs).toEqual(['[runner] game loop failed espn-a: boom']);
  });
});
