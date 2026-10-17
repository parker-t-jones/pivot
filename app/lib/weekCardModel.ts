/** Free weekly allowance for bets and props. Pro is uncapped. M1 replaces the Pro check. */
export const FREE_BET_ALLOWANCE = 3;

const FANTASY_TYPES = new Set(['ROSTERED', 'OPPONENT_ROSTERED']);

/**
 * Same rule as the API cap: a survivor pick does not use a free slot, and neither does a
 * fantasy row. Every other condition does, including a missing type.
 */
export function countsTowardFreeCap(type: string | null | undefined): boolean {
  if (type === 'SURVIVOR') return false;
  return type == null || !FANTASY_TYPES.has(type);
}

export function freeBetCount(stakes: readonly { condition: { type: string } }[]): number {
  return stakes.filter((stake) => countsTowardFreeCap(stake.condition.type)).length;
}

/** Opponent strip for the league currently selected on the chip row. */
export type OpponentStripStatus = 'unknown' | 'sleeper-only' | 'on' | 'off';

/**
 * Unknown until the browsed league's lineup and the preference have both loaded.
 * A loaded non-Sleeper league is "Sleeper only". On/off is the preference for a
 * loaded Sleeper league — never a default Off while the league is still unknown.
 */
export function opponentStripStatus(input: {
  browsedLeagueReady: boolean;
  platform: string | null;
  preferenceKnown: boolean;
  watchOpponent: boolean;
}): OpponentStripStatus {
  if (!input.browsedLeagueReady || !input.preferenceKnown) return 'unknown';
  if (input.platform !== 'sleeper') return 'sleeper-only';
  return input.watchOpponent ? 'on' : 'off';
}

export interface WeekCardInputs {
  /** Unique starters in the browsed league who play this week. `null` while that lineup or the week schedule is unknown. */
  starterCount: number | null;
  opponentStatus: OpponentStripStatus;
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
  /** Opponent cell can be tapped to toggle tracking. */
  toggleable?: boolean;
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
    opponent: opponentCell(inputs.opponentStatus),
    bets: betCell(inputs.betCount, inputs.isPro),
    pools: {
      label: 'Pools',
      ...countValue(inputs.survivorCount, (count) => ({ value: String(count), accent: false })),
    },
  };
}

function opponentCell(status: OpponentStripStatus): WeekCardCell {
  if (status === 'unknown') {
    return { label: 'Opponent', value: '\u2026', accent: false, muted: true, toggleable: false };
  }
  if (status === 'sleeper-only') {
    return {
      label: 'Opponent',
      value: 'Sleeper only',
      accent: false,
      muted: true,
      toggleable: false,
    };
  }
  return {
    label: 'Opponent',
    value: status === 'on' ? 'Tracking' : 'Off',
    accent: false,
    muted: false,
    toggleable: true,
  };
}

/**
 * Bets-tab prompt when that tab has fewer than 3 rows. At the free cap the
 * week card already says there are no free bets left, so this row stays hidden.
 * Survivor picks are not in `betsUsed` (`freeBetCount`).
 */
export function sparseBetPrompt(input: {
  rowCount: number;
  betsUsed: number;
  isPro: boolean;
}): string | null {
  if (input.rowCount >= 3) return null;
  if (input.isPro) return 'Add a pick';
  const left = FREE_BET_ALLOWANCE - input.betsUsed;
  if (left <= 0) return null;
  return `${left} free bets left · Add a pick`;
}

export interface BrowsedStarterSlot {
  slot_type: string;
  position_in_lineup: string;
  player: { player_id: string; team: { abbreviation: string } | null };
}

/**
 * Unique starters in one league who have a game this week. Bench and bye-week
 * players are left out. A player in two slots counts once.
 */
export function browsedStarterCount(
  slots: readonly BrowsedStarterSlot[],
  weekGames: readonly { home_team: string; away_team: string }[],
): number {
  const playing = new Set<string>();
  for (const game of weekGames) {
    playing.add(game.home_team.trim().toUpperCase());
    playing.add(game.away_team.trim().toUpperCase());
  }
  const seen = new Set<string>();
  for (const slot of slots) {
    if (isBenchSlot(slot)) continue;
    const id = slot.player.player_id;
    if (seen.has(id)) continue;
    const abbr = slot.player.team?.abbreviation.trim().toUpperCase() ?? '';
    if (abbr.length === 0 || !playing.has(abbr)) continue;
    seen.add(id);
  }
  return seen.size;
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
