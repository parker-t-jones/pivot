/** Free weekly allowance for bets and props. Pro is uncapped. M1 replaces the Pro check. */
export const FREE_BET_ALLOWANCE = 3;

export interface WeekCardInputs {
  /** Starters this week across watched leagues. Zero when the user has no leagues. `null` when the request failed. */
  starterCount: number | null;
  watchOpponent: boolean;
  /** Non-survivor bets this week. `null` when the request failed. */
  betCount: number | null;
  survivorCount: number | null;
  /** `subscription_tier === 'pro'`. */
  isPro: boolean;
}

export interface WeekCardCell {
  label: string;
  value: string;
  /** Free remaining-allowance copy uses `accent`. Everything else stays primary. */
  accent: boolean;
  /** Failed request. The value is an em dash in the muted color, never 0. */
  muted: boolean;
  /** Desktop segment when it differs from `label` + `value`. */
  strip?: string;
  /** Free user has used the weekly allowance. */
  upgrade?: boolean;
}

export interface WeekCardModel {
  fantasy: WeekCardCell;
  opponent: WeekCardCell;
  bets: WeekCardCell;
  pools: WeekCardCell;
}

const UNKNOWN = '\u2014';

function betCell(count: number | null, isPro: boolean): WeekCardCell {
  if (count == null) {
    return {
      label: isPro ? 'Bets & props' : 'Free bets',
      value: UNKNOWN,
      accent: false,
      muted: true,
    };
  }
  if (isPro) {
    return { label: 'Bets & props', value: String(count), accent: false, muted: false };
  }
  const left = Math.max(0, FREE_BET_ALLOWANCE - count);
  const atCap = count >= FREE_BET_ALLOWANCE;
  return {
    label: 'Free bets',
    value: atCap ? 'No free bets left' : `${left} left`,
    strip: atCap ? 'No free bets left' : `${left} free bets left this week`,
    accent: true,
    muted: false,
    upgrade: atCap,
  };
}

function countValue(
  count: number | null,
  format: (count: number) => { value: string; accent: boolean },
): Pick<WeekCardCell, 'value' | 'accent' | 'muted'> {
  if (count == null) return { value: UNKNOWN, accent: false, muted: true };
  return { ...format(count), muted: false };
}

export function weekCardModel(inputs: WeekCardInputs): WeekCardModel {
  return {
    fantasy: {
      label: 'Fantasy',
      ...countValue(inputs.starterCount, (count) => ({ value: String(count), accent: false })),
    },
    opponent: {
      label: 'Opponent',
      value: inputs.watchOpponent ? 'Tracking' : 'Off',
      accent: false,
      muted: false,
    },
    bets: betCell(inputs.betCount, inputs.isPro),
    pools: {
      label: 'Pools',
      ...countValue(inputs.survivorCount, (count) => ({ value: String(count), accent: false })),
    },
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
