import { formatStakeLabel, type StakeTeam } from '@pivot/shared/stakeLabel';

import {
  pickedSideOf,
  spreadLineModel,
  totalLineModel,
  type GameScore,
  type LineScaleModel,
} from './stakeCards';
import { watchlistStatusLabel, type WatchlistTableLive } from './watchlistTable';

/**
 * One Watchlist card per non-fantasy pick (issue #13): a type eyebrow, the pick in
 * accent, matchup + kickoff/status, a live progress bar, and a dimmed final.
 *
 * A final card shows the score from the week schedule ("FINAL · 24–17"), or FINAL
 * when the schedule has none. It never states an outcome (covered / lost).
 */

export type PickCardPhase = 'upcoming' | 'live' | 'final';

export interface PickCardStake {
  game_id: string;
  subject: { type: string; teamId?: string };
  condition: { type: string; line?: number };
  game: {
    scheduled_start: string;
    status: string;
    home_team_id: string;
    away_team_id: string;
    home_team: string;
    away_team: string;
  } | null;
}

export interface PickCardWeekGame {
  game_id: string;
  status: string;
  scheduled_start: string;
  final_score?: { home: number; away: number } | null;
}

export interface PickCardModel {
  /** SPREAD, TOTAL, MONEYLINE, SURVIVOR, or PICK for a type this client does not know. */
  eyebrow: string;
  /** "DET −3.5", "O 84.5", "DET ML", "DET". */
  pick: string;
  awayTeam: string | null;
  homeTeam: string | null;
  /** "DET @ GB", or empty when the stake has no game. */
  matchup: string;
  /** Kickoff, live score and clock, or FINAL. */
  status: string;
  phase: PickCardPhase;
  /** Live only, and only when the live feed has a score. */
  progress: LineScaleModel | null;
  /** Axis end label for `progress`, e.g. "14". */
  axisLabel: string;
}

const EYEBROWS: Record<string, string> = {
  SPREAD: 'SPREAD',
  TOTAL_OVER: 'TOTAL',
  TOTAL_UNDER: 'TOTAL',
  MONEYLINE: 'MONEYLINE',
  SURVIVOR: 'SURVIVOR',
};

export function pickEyebrow(type: string): string {
  return EYEBROWS[type] ?? 'PICK';
}

function magnitude(line: number): string {
  return String(Math.abs(line));
}

/** Short pick text for the accent line. Spread uses a true minus (`formatStakeLabel`). */
export function pickText(stake: PickCardStake, teams: readonly StakeTeam[]): string {
  const type = stake.condition.type;
  const line = stake.condition.line;
  if (type === 'TOTAL_OVER' || type === 'TOTAL_UNDER') {
    const prefix = type === 'TOTAL_OVER' ? 'O' : 'U';
    return typeof line === 'number' ? `${prefix} ${magnitude(line)}` : prefix;
  }
  if (type === 'SURVIVOR') {
    const teamId = stake.subject.teamId ?? '';
    return teams.find((team) => team.teamId === teamId)?.abbreviation ?? teamId;
  }
  return formatStakeLabel(stake, teams);
}

export function pickCardModel(input: {
  stake: PickCardStake;
  teams: readonly StakeTeam[];
  weekGames: readonly PickCardWeekGame[] | null;
  liveGames: readonly (WatchlistTableLive & { status?: string })[];
  now: Date;
}): PickCardModel {
  const { stake } = input;
  const type = stake.condition.type;
  const live = input.liveGames.find((game) => game.game_id === stake.game_id) ?? null;
  const weekGame = input.weekGames?.find((game) => game.game_id === stake.game_id) ?? null;
  const scheduled = weekGame?.status ?? stake.game?.status ?? 'scheduled';
  const isFinal = scheduled === 'final';
  const inProgress = !isFinal && (live !== null || scheduled === 'in_progress');
  const phase: PickCardPhase = isFinal ? 'final' : inProgress ? 'live' : 'upcoming';
  const kickoffIso = weekGame?.scheduled_start ?? stake.game?.scheduled_start ?? null;
  const status = watchlistStatusLabel({
    bye: false,
    isFinal,
    inProgress,
    kickoff: kickoffIso == null ? null : new Date(kickoffIso),
    now: input.now,
    live,
    finalScore: isFinal ? (weekGame?.final_score ?? null) : null,
  }).text;

  const score: GameScore | null = phase === 'live' && live ? live.score : null;
  const { progress, axisLabel } = progressFor(stake, score);

  return {
    eyebrow: pickEyebrow(type),
    pick: pickText(stake, input.teams),
    awayTeam: stake.game?.away_team ?? null,
    homeTeam: stake.game?.home_team ?? null,
    matchup: stake.game ? `${stake.game.away_team} @ ${stake.game.home_team}` : '',
    status,
    phase,
    progress,
    axisLabel,
  };
}

/**
 * Spread: cover margin. Total: combined points against the line. Moneyline and
 * survivor: the picked team's margin (a spread of 0).
 */
function progressFor(
  stake: PickCardStake,
  score: GameScore | null,
): { progress: LineScaleModel | null; axisLabel: string } {
  const type = stake.condition.type;
  const line = stake.condition.line;
  if (type === 'TOTAL_OVER' || type === 'TOTAL_UNDER') {
    if (score == null || typeof line !== 'number') return { progress: null, axisLabel: '21' };
    return {
      progress: totalLineModel({
        line,
        side: type === 'TOTAL_OVER' ? 'over' : 'under',
        status: 'in_progress',
        score,
      }),
      axisLabel: '21',
    };
  }
  const game = stake.game;
  const side = game ? pickedSideOf(stake.subject.teamId, game) : null;
  if (score == null || side == null) return { progress: null, axisLabel: '14' };
  if (type === 'SPREAD') {
    if (typeof line !== 'number') return { progress: null, axisLabel: '14' };
    return {
      progress: spreadLineModel({ line, pickedSide: side, status: 'in_progress', score }),
      axisLabel: '14',
    };
  }
  if (type === 'MONEYLINE' || type === 'SURVIVOR') {
    return {
      progress: spreadLineModel({ line: 0, pickedSide: side, status: 'in_progress', score }),
      axisLabel: '14',
    };
  }
  return { progress: null, axisLabel: '14' };
}
