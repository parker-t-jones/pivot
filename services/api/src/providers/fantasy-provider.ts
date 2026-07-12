import type { LeaguePlatform } from '@fantasy-focus/shared';
import type { RosterMappingSlot } from './roster-mapping.js';

/** Normalized lineup slot, agnostic of which platform it came from. */
export type NormalizedLineupSlot = RosterMappingSlot;

export interface FetchLineupInput {
  externalLeagueId: string;
  externalRosterId: string;
  week: number;
}

/**
 * Swap-ready boundary for fantasy platforms (PLAN.md Section 2). `SleeperProvider` and
 * `ManualProvider` implement this in v1; ESPN/Yahoo/NFL Fantasy providers slot in later
 * without touching callers (routes, lineup sync worker).
 */
export interface FantasyProvider {
  readonly platform: LeaguePlatform;

  /** False for platforms with no external source to sync from (e.g. manual leagues). */
  supportsSync(): boolean;

  /** Fetches and normalizes a league roster's lineup for a given week. */
  fetchLineup(input: FetchLineupInput): Promise<NormalizedLineupSlot[]>;
}
