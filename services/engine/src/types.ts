import type { PlayEvent } from './playEvent.js';

/**
 * Swap-ready boundary for play-by-play sources (PLAN.md Section 2). `ReplayPlaySource` (file-backed
 * nflverse data) implements this for tests and local dev; `EspnPlaySource` (`@pivot/ingestion`) is
 * the production source. Either slots in without touching the engine, which only ever sees
 * normalized `PlayEvent`s — a future provider swap is a new adapter, not an engine change.
 */
export interface PlaySource {
  readonly id: 'espn' | 'replay' | 'mock';
  subscribe(handler: (play: PlayEvent) => Promise<void>): Promise<void>;
  disconnect(): Promise<void>;
}

export type { PlayEvent, PlayType, TeamId } from './playEvent.js';
