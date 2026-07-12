import type { FantasyProvider } from './fantasy-provider.js';
import { ManualProvider } from './manual-provider.js';
import { SleeperProvider } from './sleeper-provider.js';

const sleeperProvider = new SleeperProvider();
const manualProvider = new ManualProvider();

/**
 * ESPN/Yahoo/NFL Fantasy platforms are recognized by `leagues.platform` but have no provider
 * yet. Takes `string` (not `LeaguePlatform`) because `leagues.platform` is enforced by a
 * Postgres CHECK constraint, not a generated DB enum type — see generated `database.types.ts`.
 */
export function getFantasyProvider(platform: string): FantasyProvider | null {
  switch (platform) {
    case 'sleeper':
      return sleeperProvider;
    case 'manual':
      return manualProvider;
    default:
      return null;
  }
}

export { sleeperProvider, manualProvider };
export type {
  FantasyProvider,
  FetchLineupInput,
  NormalizedLineupSlot,
} from './fantasy-provider.js';
export type { SleeperLeagueConnection } from './sleeper-provider.js';
