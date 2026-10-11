/** Free weekly allowance for bets and props. Pro is uncapped. M1 replaces the Pro check. */
export const FREE_BET_ALLOWANCE = 3;

export interface WeekCardInputs {
  /** Starters this week across watched leagues. Zero when the user has no leagues. */
  starterCount: number;
  watchOpponent: boolean;
  /** Non-survivor bets this week. */
  betCount: number;
  survivorCount: number;
  /** `subscription_tier === 'pro'`. */
  isPro: boolean;
}

export interface WeekCardCell {
  label: string;
  value: string;
  /** Free "N of 3 free" uses `accent`. Everything else stays primary. */
  accent: boolean;
}

export interface WeekCardModel {
  fantasy: WeekCardCell;
  opponent: WeekCardCell;
  bets: WeekCardCell;
  pools: WeekCardCell;
}

export function weekCardModel(inputs: WeekCardInputs): WeekCardModel {
  const betsValue = inputs.isPro
    ? String(inputs.betCount)
    : `${inputs.betCount} of ${FREE_BET_ALLOWANCE} free`;
  return {
    fantasy: { label: 'Fantasy', value: String(inputs.starterCount), accent: false },
    opponent: {
      label: 'Opponent',
      value: inputs.watchOpponent ? 'Tracking' : 'Off',
      accent: false,
    },
    bets: { label: 'Bets & props', value: betsValue, accent: !inputs.isPro },
    pools: { label: 'Pools', value: String(inputs.survivorCount), accent: false },
  };
}

/** Same bench rule as the Lineup roster wells: bench slot type, or BN / BENCH / IR / TAXI. */
export function isBenchSlot(slot: { slot_type: string; position_in_lineup: string }): boolean {
  if (slot.slot_type === 'bench') return true;
  const raw = slot.position_in_lineup.trim().toUpperCase();
  return raw === 'BN' || raw === 'BENCH' || raw === 'IR' || raw === 'TAXI';
}

export interface StarterLineup {
  leagueId: string;
  slots: readonly { slot_type: string; position_in_lineup: string }[];
}

/**
 * Starters across watched leagues. An empty watched list means every league, matching
 * Home and the Lineup "WATCHING" label. No leagues is zero.
 */
export function watchedStarterCount(
  lineups: readonly StarterLineup[],
  watchedLeagueIds: readonly string[],
): number {
  const watching =
    watchedLeagueIds.length === 0
      ? lineups
      : lineups.filter((lineup) => watchedLeagueIds.includes(lineup.leagueId));
  let count = 0;
  for (const lineup of watching) {
    for (const slot of lineup.slots) {
      if (!isBenchSlot(slot)) count += 1;
    }
  }
  return count;
}
