import { describe, expect, it } from 'vitest';
import { observeResolution } from './observeResolution.js';

describe('observeResolution', () => {
  it('logs a rejected noteResolution and the game loop continues', async () => {
    const logs: string[] = [];
    const plays: string[] = [];

    const handlePlay = async (playId: string, note: () => Promise<void>): Promise<void> => {
      observeResolution('game-1', note(), (line) => logs.push(line));
      plays.push(playId);
    };

    const rejected = Promise.reject(new Error('enqueue failed'));
    await handlePlay('p1', () => rejected);
    await rejected.catch(() => undefined);
    await handlePlay('p2', () => Promise.resolve());

    expect(logs).toEqual(['[runner] noteResolution failed game-1: enqueue failed']);
    expect(plays).toEqual(['p1', 'p2']);
  });
});
