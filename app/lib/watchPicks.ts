import type { PickProgress, SlipSummary } from '@pivot/shared/picks';
import { formatStakeLabel } from '@pivot/shared/stakeLabel';

import {
  PARLAY_TYPE,
  isParlay,
  stakeTeams,
  type ManualStake,
  type ManualStakeGame,
  type StakesResponse,
} from './stakes';
import { freeBetCount } from './weekCardModel';

/** One pick as `GET /picks` returns it (docs/P2-PICKS-MODEL.md §7). */
export interface PicksApiPick {
  id: string;
  season: number;
  week: number;
  game_id: string;
  source: string;
  weight: number;
  subject: { type: string; teamId?: string; gameId?: string; playerId?: string };
  condition: { type: string; line?: number; side?: string; segment?: string };
  slip_id: string | null;
  label: string;
  game: ManualStakeGame | null;
  progress: PickProgress;
}

export interface PicksApiSlip {
  id: string;
  season: number;
  week: number;
  created_at: string;
  result: string | null;
  summary: SlipSummary;
  legs: PicksApiPick[];
}

export interface PicksApiResponse {
  week: number;
  free_limit: number;
  free_slots_used: number;
  picks: PicksApiPick[];
  slips: PicksApiSlip[];
}

function toStake(pick: PicksApiPick): ManualStake {
  return {
    id: pick.id,
    season: pick.season,
    week: pick.week,
    game_id: pick.game_id,
    source: pick.source,
    weight: pick.weight,
    subject: pick.subject,
    condition: pick.condition,
    game: pick.game,
    label: pick.label,
    progress: pick.progress,
  };
}

function kickoffMs(stake: ManualStake): number {
  const at = stake.game ? Date.parse(stake.game.scheduled_start) : Number.NaN;
  return Number.isFinite(at) ? at : Number.MAX_SAFE_INTEGER;
}

/**
 * The leg a parlay row is ordered and shown by: the first live leg, else the next leg to kick
 * off, else the last leg to finish. Legs are sorted by kickoff.
 */
export function parlayFocusLeg<T extends ManualStake>(legs: readonly T[]): T | null {
  const sorted = legs.slice().sort((a, b) => kickoffMs(a) - kickoffMs(b));
  return (
    sorted.find((leg) => leg.game?.status === 'in_progress') ??
    sorted.find((leg) => leg.game?.status !== 'final') ??
    sorted.at(-1) ??
    null
  );
}

export function parlayTitle(legCount: number): string {
  return `${legCount}-leg parlay`;
}

/** A slip as one Watchlist row. It counts as one free pick, like the API (#10). */
export function parlayRow(slip: PicksApiSlip): ManualStake | null {
  const legs = slip.legs.map(toStake);
  const focus = parlayFocusLeg(legs);
  if (focus === null) return null;
  return {
    id: slip.id,
    season: slip.season,
    week: slip.week,
    game_id: focus.game_id,
    source: 'MANUAL',
    weight: 1,
    subject: { type: 'SLIP' },
    condition: { type: PARLAY_TYPE },
    game: focus.game,
    label: parlayTitle(legs.length),
    legs,
    summary: slip.summary,
  };
}

/**
 * `GET /picks` in the shape the Watchlist and Home already use for `GET /stakes`. Singles keep
 * their label and progress; each parlay is one row. `free_slots_spent` is derived so that
 * `freeBetCount(stakes, free_slots_spent)` equals the API's `free_slots_used`, and the existing
 * kickoff rule can keep adjusting it locally after a removal.
 */
export function watchPicksResponse(response: PicksApiResponse): StakesResponse {
  const singles = response.picks.map(toStake);
  const parlays = response.slips.flatMap((slip) => {
    const row = parlayRow(slip);
    return row ? [row] : [];
  });
  const stakes = [...singles, ...parlays];
  return {
    week: response.week,
    stakes,
    free_slots_spent: Math.max(0, response.free_slots_used - freeBetCount(stakes, 0)),
  };
}

/** Singles plus every parlay leg, for per-game views (the Home board). */
export function flattenParlays(stakes: readonly ManualStake[]): ManualStake[] {
  return stakes.flatMap((stake) => (stake.legs && stake.legs.length > 0 ? stake.legs : [stake]));
}

/** The API's label when it has one, else the label this client builds for the four old types. */
export function watchPickLabel(stake: ManualStake): string {
  if (stake.label && stake.label.length > 0) return stake.label;
  if (isParlay(stake)) return parlayTitle(stake.legs?.length ?? 0);
  return formatStakeLabel(stake, stakeTeams(stake));
}
