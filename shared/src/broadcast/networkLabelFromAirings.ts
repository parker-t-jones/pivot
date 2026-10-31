import type { AiringNetwork } from './types.js';

/**
 * Board-column label from airings (§7.2). ESPN beats ABC on MNF.
 * "On {network}" uses `onNetworkLabel`, not these short tokens.
 */
const NETWORK_RANK_AND_LABEL: Record<AiringNetwork, { rank: number; label: string }> = {
  cbs: { rank: 0, label: 'CBS' },
  fox: { rank: 1, label: 'FOX' },
  nbc: { rank: 2, label: 'NBC' },
  espn: { rank: 3, label: 'ESPN' },
  abc: { rank: 4, label: 'ABC' },
  amazon_prime: { rank: 5, label: 'PRIME' },
  peacock: { rank: 6, label: 'PEACOCK' },
  nfl_network: { rank: 7, label: 'NFLN' },
  netflix: { rank: 8, label: 'NETFLIX' },
  espn_plus: { rank: 9, label: 'ESPN+' },
  paramount_plus: { rank: 10, label: 'PARAMOUNT+' },
  nfl_plus: { rank: 11, label: 'NFL+' },
};

/** Spelling for "On {network}". The board column keeps the short token in `NETWORK_RANK_AND_LABEL`. */
const ON_NETWORK_DISPLAY: Partial<Record<AiringNetwork, string>> = {
  cbs: 'CBS',
  fox: 'FOX',
  nbc: 'NBC',
  abc: 'ABC',
  espn: 'ESPN',
  amazon_prime: 'Prime Video',
  peacock: 'Peacock',
  nfl_network: 'NFL Network',
  netflix: 'Netflix',
  paramount_plus: 'Paramount+',
};

export function networkRank(network: AiringNetwork): number | null {
  return NETWORK_RANK_AND_LABEL[network]?.rank ?? null;
}

/** A known airing key, or the string unchanged when it is not one. */
export function onNetworkName(network: string): string {
  return ON_NETWORK_DISPLAY[network as AiringNetwork] ?? network;
}

export function networkLabelFromAirings(airings: readonly { network: string }[]): string | null {
  let best: { rank: number; label: string } | null = null;
  for (const airing of airings) {
    const mapped = NETWORK_RANK_AND_LABEL[airing.network as AiringNetwork];
    if (!mapped) continue;
    if (!best || mapped.rank < best.rank) best = mapped;
  }
  return best?.label ?? null;
}

/** Same winning airing as `networkLabelFromAirings`, spelled for "On {network}". */
export function onNetworkLabel(airings: readonly { network: string }[]): string | null {
  let best: { rank: number; network: AiringNetwork; label: string } | null = null;
  for (const airing of airings) {
    const network = airing.network as AiringNetwork;
    const mapped = NETWORK_RANK_AND_LABEL[network];
    if (!mapped) continue;
    if (!best || mapped.rank < best.rank)
      best = { rank: mapped.rank, network, label: mapped.label };
  }
  if (!best) return null;
  return ON_NETWORK_DISPLAY[best.network] ?? best.label;
}
