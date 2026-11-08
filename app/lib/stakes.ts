import type { StakeTeam } from '@pivot/shared/stakeLabel';

import { countsTowardFreeCap } from './weekCardModel';

export type { StakeLabelSource, StakeTeam } from '@pivot/shared/stakeLabel';
export { formatStakeLabel } from '@pivot/shared/stakeLabel';

export type ManualStakeType = 'SPREAD' | 'TOTAL_OVER' | 'TOTAL_UNDER' | 'MONEYLINE' | 'SURVIVOR';

export interface StakeRequest {
  type: ManualStakeType;
  gameId: string;
  teamId?: string;
  line?: number;
}

export interface ManualStakeGame {
  scheduled_start: string;
  status: string;
  home_team_id: string;
  away_team_id: string;
  home_team: string;
  away_team: string;
  home_team_name: string;
  away_team_name: string;
}

export interface ManualStake {
  id: string;
  season: number;
  week: number;
  game_id: string;
  source: string;
  weight: number;
  subject: { type: string; teamId?: string; gameId?: string };
  condition: { type: string; line?: number; side?: string };
  game: ManualStakeGame | null;
}

export interface StakesResponse {
  week: number;
  stakes: ManualStake[];
  /**
   * Free-cap picks removed after kickoff this week. Each keeps one free slot spent.
   * Missing on older API builds and on the demo account; treat as 0.
   */
  free_slots_spent?: number;
}

const MINUS = '\u2212';

function isHalfPoint(line: number): boolean {
  const doubled = line * 2;
  return Math.abs(doubled - Math.round(doubled)) < 1e-6;
}

function formatMagnitude(line: number): string {
  const abs = Math.abs(line);
  return Number.isInteger(abs) ? String(abs) : String(abs);
}

/** Negative lines use a true minus sign. Non-negative lines use a plus. */
export function formatSignedLine(line: number): string {
  return line < 0 ? `${MINUS}${formatMagnitude(line)}` : `+${formatMagnitude(line)}`;
}

export function validateLine(
  type: ManualStakeType,
  input: string,
): { ok: true; line?: number } | { ok: false; message: string } {
  const trimmed = input.trim();
  if (type === 'MONEYLINE' || type === 'SURVIVOR') {
    if (trimmed.length > 0) {
      return { ok: false, message: 'This bet does not take a line.' };
    }
    return { ok: true };
  }

  if (trimmed.length === 0) return { ok: false, message: 'Enter a line.' };
  const negative = trimmed.startsWith('-') || trimmed.startsWith(MINUS);
  const numeric = trimmed.replace(/^[+\u2212-]/, '');
  if (numeric.length === 0) return { ok: false, message: 'Enter a line.' };
  const value = Number(numeric);
  if (!Number.isFinite(value)) return { ok: false, message: 'Enter a number.' };
  const signed = negative ? -Math.abs(value) : Math.abs(value);

  if (!isHalfPoint(signed)) {
    return { ok: false, message: 'Use steps of 0.5.' };
  }
  if (type === 'SPREAD') {
    const magnitude = Math.abs(signed);
    if (magnitude < 0.5) {
      return { ok: false, message: 'Spread must be at least 0.5.' };
    }
    if (magnitude > 50) {
      return { ok: false, message: 'Spread must be between −50 and +50.' };
    }
    return { ok: true, line: signed };
  }
  if (signed < 10 || signed > 100) {
    return { ok: false, message: 'Total must be between 10 and 100.' };
  }
  return { ok: true, line: signed };
}

export function buildStakeRequest(input: {
  type: ManualStakeType;
  gameId: string;
  teamId?: string;
  line?: number;
}): StakeRequest {
  const needsTeam =
    input.type === 'SPREAD' || input.type === 'MONEYLINE' || input.type === 'SURVIVOR';
  const needsLine =
    input.type === 'SPREAD' || input.type === 'TOTAL_OVER' || input.type === 'TOTAL_UNDER';
  const request: StakeRequest = { type: input.type, gameId: input.gameId };
  if (needsTeam && input.teamId !== undefined) request.teamId = input.teamId;
  if (needsLine && input.line !== undefined) request.line = input.line;
  return request;
}

export function stakeErrorCopy(code: string): string {
  switch (code) {
    case 'stake_game_invalid':
      return 'That game is not open for a bet.';
    case 'stake_team_invalid':
      return 'Pick a team in that game.';
    case 'stake_line_invalid':
      return 'That line is not valid.';
    case 'survivor_pick_exists':
      return 'You already have a survivor pick this week.';
    case 'stake_duplicate':
      return 'You already added this bet.';
    case 'stake_managed_by_sync':
      return 'This bet is managed by your league sync.';
    default:
      return 'Could not save that bet.';
  }
}

export function stakeTeams(stake: ManualStake): StakeTeam[] {
  if (!stake.game) return [];
  return [
    { teamId: stake.game.home_team_id, abbreviation: stake.game.home_team },
    { teamId: stake.game.away_team_id, abbreviation: stake.game.away_team },
  ];
}

/** Shown before a free user removes a counted pick whose game has started. */
export const REMOVE_STARTED_PICK_NOTE =
  "The game has started, so removing this pick won't free up a slot for this week.";

/**
 * Same rule as the API: a game has kicked off once it is live or final, or once its
 * scheduled start has passed.
 */
export function stakeGameHasKickedOff(stake: ManualStake, now: Date): boolean {
  const game = stake.game;
  if (game === null) return false;
  if (game.status === 'in_progress' || game.status === 'final') return true;
  const start = Date.parse(game.scheduled_start);
  return Number.isFinite(start) && start <= now.getTime();
}

/** Same rule as the API: removing a counted pick after kickoff keeps its free slot spent. */
export function removalKeepsFreeSlot(stake: ManualStake, now: Date): boolean {
  return countsTowardFreeCap(stake.condition.type) && stakeGameHasKickedOff(stake, now);
}

/** Body of the "Remove this bet?" confirm. Pro has no cap, so it gets no slot note. */
export function removePickMessage(
  stake: ManualStake,
  label: string,
  input: { isPro: boolean; now: Date },
): string {
  if (input.isPro || !removalKeepsFreeSlot(stake, input.now)) return label;
  return `${label}\n\n${REMOVE_STARTED_PICK_NOTE}`;
}
