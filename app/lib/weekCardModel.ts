/** Free weekly allowance for single picks and parlay legs. Pro is uncapped. M1 replaces the Pro check. */
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

/**
 * Free slots used this week: live single picks and parlay legs that count, plus `spent` picks that were removed
 * after kickoff (`free_slots_spent` on `GET /stakes`).
 */
export function freeBetCount(
  stakes: readonly {
    condition: { type: string };
    legs?: readonly { condition: { type: string } }[];
  }[],
  spent = 0,
): number {
  return stakes.reduce(
    (sum, stake) =>
      sum +
      (stake.legs ? freeBetCount(stake.legs) : Number(countsTowardFreeCap(stake.condition.type))),
    spent,
  );
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
  /** NFL week the card is for. `null` before the week is known. */
  week?: number | null;
  /** Games this week the card covers (`cardGameCount`). `null` while unknown. */
  gameCount?: number | null;
}

export interface WeekCardCell {
  label: string;
  value: string;
  /** `note` (the free allowance) is in the accent color. Values stay primary. */
  accent: boolean;
  /** Failed request. The value is an em dash in the muted color, never 0. */
  muted: boolean;
  /** Desktop segment when it differs from `label` + `value`. */
  strip?: string;
  /** Second line under the value: the free allowance. Absent on Pro. */
  note?: string;
  /** Free user has used the weekly allowance. */
  upgrade?: boolean;
  /** Opponent cell can be tapped to toggle tracking. */
  toggleable?: boolean;
}

export interface WeekCardModel {
  /** "YOUR WEEK 9 CARD", or "YOUR WEEK CARD" before the week is known. */
  eyebrow: string;
  /** "6 GAMES" / "1 GAME". `null` hides it. */
  gameCountLabel: string | null;
  fantasy: WeekCardCell;
  opponent: WeekCardCell;
  bets: WeekCardCell;
  pools: WeekCardCell;
}

const UNKNOWN = '\u2014';

const BETS_LABEL = 'Bets & props';

function betCell(count: number | null, isPro: boolean): WeekCardCell {
  if (count == null) {
    return { label: BETS_LABEL, value: UNKNOWN, accent: false, muted: true };
  }
  const value = String(count);
  if (isPro) {
    return { label: BETS_LABEL, value, accent: false, muted: false };
  }
  const left = Math.max(0, FREE_BET_ALLOWANCE - count);
  const atCap = count >= FREE_BET_ALLOWANCE;
  const note = atCap ? 'No free bets left' : `${left} free left`;
  return {
    label: BETS_LABEL,
    value,
    note,
    strip: `${BETS_LABEL} ${value} \u00b7 ${note}`,
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
  const week = inputs.week ?? null;
  const games = inputs.gameCount ?? null;
  return {
    eyebrow: week == null ? 'YOUR WEEK CARD' : `YOUR WEEK ${week} CARD`,
    gameCountLabel: games == null ? null : `${games} ${games === 1 ? 'GAME' : 'GAMES'}`,
    fantasy: {
      label: 'Fantasy',
      ...countValue(inputs.starterCount, (count) => ({ value: String(count), accent: false })),
    },
    opponent: opponentCell(inputs.opponentStatus),
    bets: betCell(inputs.betCount, inputs.isPro),
    pools: {
      label: 'Survivor pool',
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

/**
 * Distinct games this week the card covers: games a playing starter's team is in,
 * plus games with a pick. Picks outside the week schedule are left out.
 */
export function cardGameCount(
  starterTeams: readonly (string | null | undefined)[],
  stakeGameIds: readonly string[],
  weekGames: readonly { game_id: string; home_team: string; away_team: string }[],
): number {
  const teams = new Set(
    starterTeams.map((abbr) => abbr?.trim().toUpperCase() ?? '').filter((abbr) => abbr.length > 0),
  );
  const picked = new Set(stakeGameIds);
  let count = 0;
  for (const game of weekGames) {
    if (
      picked.has(game.game_id) ||
      teams.has(game.home_team.trim().toUpperCase()) ||
      teams.has(game.away_team.trim().toUpperCase())
    ) {
      count += 1;
    }
  }
  return count;
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
