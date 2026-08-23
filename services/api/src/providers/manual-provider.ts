import type { LeaguePlatform } from '@pivot/shared';
import { ApiError } from '../lib/errors.js';
import type {
  FantasyProvider,
  FetchLineupInput,
  FetchRosterPlayersInput,
  NormalizedLineupSlot,
} from './fantasy-provider.js';

/**
 * `ManualProvider` (PLAN.md Section 2 swap-ready `FantasyProvider` boundary).
 * Manual leagues have no external source — lineups are entered directly via
 * `PUT /leagues/:id/lineup`, so there is nothing to sync from.
 */
export class ManualProvider implements FantasyProvider {
  readonly platform: LeaguePlatform = 'manual';

  supportsSync(): boolean {
    return false;
  }

  async fetchLineup(_input: FetchLineupInput): Promise<NormalizedLineupSlot[]> {
    throw new ApiError(
      400,
      'sync_not_supported',
      'Manual leagues have no external source to sync from.',
    );
  }

  async fetchRosterPlayers(_input: FetchRosterPlayersInput): Promise<string[]> {
    throw new ApiError(
      400,
      'sync_not_supported',
      'Manual leagues have no external source to sync from.',
    );
  }
}
