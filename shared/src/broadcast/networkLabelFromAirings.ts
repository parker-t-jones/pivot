import type { AiringNetwork } from './types.js';

/**
 * Board-column label from airings (§7.2). ESPN beats ABC on MNF.
 * Lives beside app `networkLabel`; does not replace it until B1.4.
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

export function networkRank(network: AiringNetwork): number | null {
  return NETWORK_RANK_AND_LABEL[network]?.rank ?? null;
}

export function networkLabelFromAirings(
  airings: readonly { network: string }[],
): string | null {
  let best: { rank: number; label: string } | null = null;
  for (const airing of airings) {
    const mapped = NETWORK_RANK_AND_LABEL[airing.network as AiringNetwork];
    if (!mapped) continue;
    if (!best || mapped.rank < best.rank) best = mapped;
  }
  return best?.label ?? null;
}
