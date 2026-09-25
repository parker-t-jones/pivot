import { CARRIAGE_2026_1 } from './carriageMap.js';
import { groupWindow } from './groupWindow.js';
import { lagSecondsForUserService } from './lag.js';
import { networkRank } from './networkLabelFromAirings.js';
import type {
  CarriageMapVersion,
  MarketConfidence,
  ParsedAiring,
  UserService,
  WatchOption,
} from './types.js';

function confidenceFor(
  entryMarketRule: CarriageMapVersion['entries'][number]['marketRule'],
  regionalSlate: boolean,
): MarketConfidence {
  if (!regionalSlate) return 'national';
  if (entryMarketRule === 'out_of_market') return 'out';
  if (entryMarketRule === 'in_market') return 'unknown';
  return 'national';
}

/**
 * Expand airings through the carriage map into watch options (§1.5–1.6).
 * Only confirmed carriage entries emit. Same service on a simulcast collapses
 * to the option whose network wins networkLabel rank (ESPN over ABC).
 */
export function expandWatchOptions(
  airings: readonly ParsedAiring[],
  kickoff: Date,
  regionalSlate: boolean,
  carriage: CarriageMapVersion = CARRIAGE_2026_1,
): WatchOption[] {
  const window = groupWindow(kickoff);
  const byService = new Map<UserService, WatchOption>();

  for (const airing of airings) {
    for (const entry of carriage.entries) {
      if (!entry.confirmed) continue;
      if (!entry.networks.includes(airing.network)) continue;
      if (entry.windows !== undefined && !entry.windows.includes(window)) continue;

      const candidate: WatchOption = {
        service: entry.service,
        network: airing.network,
        requiresSubscription: true,
        marketConfidence: confidenceFor(entry.marketRule, regionalSlate),
        typicalLagSeconds: lagSecondsForUserService(entry.service),
        preferred: false,
      };

      const existing = byService.get(entry.service);
      if (!existing) {
        byService.set(entry.service, candidate);
        continue;
      }
      // Simulcast collapse: keep the network that wins board-label rank.
      const existingRank = networkRank(existing.network) ?? Number.POSITIVE_INFINITY;
      const candidateRank = networkRank(candidate.network) ?? Number.POSITIVE_INFINITY;
      if (candidateRank < existingRank) {
        byService.set(entry.service, candidate);
      }
    }
  }

  return [...byService.values()];
}
