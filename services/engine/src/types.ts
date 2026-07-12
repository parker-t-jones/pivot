import type { PlayEvent } from './playEvent.js';

/**
 * Swap-ready boundary for play-by-play sources (PLAN.md Section 2). `ReplayPlaySource` (file-backed
 * nflverse data) implements this in Sprint 4; a real `SportradarPlaySource` (push feed) slots in at
 * Sprint 2/5 without touching the engine, which only ever sees normalized `PlayEvent`s.
 */
export interface PlaySource {
  readonly id: 'sportradar' | 'replay' | 'mock';
  subscribe(handler: (play: PlayEvent) => Promise<void>): Promise<void>;
  disconnect(): Promise<void>;
}

export type { PlayEvent, PlayType, TeamId } from './playEvent.js';
