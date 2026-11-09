import { formatStakeLabel, type StakeTeam } from '@pivot/shared/stakeLabel';

import {
  pickedSideOf,
  spreadLineModel,
  totalLineModel,
  type GameScore,
  type LineScaleModel,
} from './stakeCards';
import type { PickProgress, SlipSummary } from '@pivot/shared/picks';

import {
  isLegacyPick,
  legStateLabel,
  parlaySummaryLine,
  pickProgressLine,
} from './pickProgressLine';
import { watchlistStatusLabel, type WatchlistTableLive } from './watchlistTable';

/**
 * One Watchlist card per non-fantasy pick (issue #13): a type eyebrow, the pick in
 * accent, matchup + kickoff/status, a live progress bar, and a dimmed final.
 *
 * A final card shows the score from the week schedule ("FINAL · 24–17"), or FINAL
 * when the schedule has none. The four original types never state an outcome (covered / lost).
 * Props, quarter and half lines, and parlays add a `detail` line from `GET /picks` progress,
 * which does name results in-app (docs/P2-PICKS-MODEL.md §6: in-app only, never pushed).
 */

export type PickCardPhase = 'upcoming' | 'live' | 'final';

export interface PickCardStake {
  id?: string;
  game_id: string;
  subject: { type: string; teamId?: string };
  condition: { type: string; line?: number; stat?: string; segment?: string };
  /** `GET /picks` label. Used for every type the four old cards don't describe. */
  label?: string;
  progress?: PickProgress;
  legs?: PickCardStake[];
  summary?: SlipSummary;
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
  /** Props, quarter and half lines, and parlays: live progress or the result, in words. */
  detail: string | null;
  /** A parlay's legs, in kickoff order. Empty for a single pick. */
  legs: PickCardLeg[];
}

export interface PickCardLeg {
  key: string;
  pick: string;
  matchup: string;
  /** Kickoff, live score and clock, or FINAL, like a pick card. */
  status: string;
  /** "Live", "Hit", "Refunded"… Null before the game. */
  state: string | null;
  /** The leg's progress line, as on a single pick card. */
  detail: string | null;
}

const EYEBROWS: Record<string, string> = {
  SPREAD: 'SPREAD',
  TOTAL_OVER: 'TOTAL',
  TOTAL_UNDER: 'TOTAL',
  MONEYLINE: 'MONEYLINE',
  SURVIVOR: 'SURVIVOR',
  STAT_OVER: 'PLAYER PROP',
  STAT_UNDER: 'PLAYER PROP',
  PLAYER_EVENT: 'PLAYER PROP',
  TEAM_TOTAL_OVER: 'TEAM PROP',
  TEAM_TOTAL_UNDER: 'TEAM PROP',
  FIRST_TO_SCORE: 'TEAM PROP',
  PARLAY: 'PARLAY',
};

/** Field-goal totals are a team prop on one team and a game prop on both. */
export function pickEyebrow(type: string, subjectType?: string): string {
  if (type === 'FG_OVER' || type === 'FG_UNDER') {
    return subjectType === 'TEAM' ? 'TEAM PROP' : 'GAME PROP';
  }
  return EYEBROWS[type] ?? 'PICK';
}

function magnitude(line: number): string {
  return String(Math.abs(line));
}

/** Short pick text for the accent line. Spread uses a true minus (`formatStakeLabel`). */
export function pickText(stake: PickCardStake, teams: readonly StakeTeam[]): string {
  if (!isLegacyPick(stake) && stake.label && stake.label.length > 0) return stake.label;
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
  // The score bar is full-game; a quarter or half line or a prop uses the progress line instead.
  const { progress, axisLabel } = isLegacyPick(stake)
    ? progressFor(stake, score)
    : { progress: null, axisLabel: '14' };

  if (stake.legs && stake.legs.length > 0) {
    const legs = stake.legs
      .map((leg) => ({
        leg,
        model: pickCardModel({ ...input, stake: leg, teams: legTeams(leg) }),
      }))
      .sort((a, b) => kickoffOf(a.leg) - kickoffOf(b.leg));
    const anyLive = legs.some(({ model }) => model.phase === 'live');
    const allFinal = legs.every(({ model }) => model.phase === 'final');
    return {
      eyebrow: pickEyebrow(type),
      pick: stake.label && stake.label.length > 0 ? stake.label : `${legs.length}-leg parlay`,
      awayTeam: null,
      homeTeam: null,
      matchup: '',
      // The leg the row is ordered by: its kickoff, live clock, or final.
      status,
      phase: anyLive ? 'live' : allFinal ? 'final' : 'upcoming',
      progress: null,
      axisLabel,
      detail: parlaySummaryLine(stake.summary),
      legs: legs.map(({ leg, model }, index) => ({
        key: leg.id ?? `${leg.game_id}-${index}`,
        // Each leg carries the API's label; a leg has no type row of its own.
        pick: leg.label && leg.label.length > 0 ? leg.label : model.pick,
        matchup: model.matchup,
        status: model.status,
        state: legStateLabel(leg.progress),
        detail: model.detail,
      })),
    };
  }

  return {
    eyebrow: pickEyebrow(type, stake.subject.type),
    pick: pickText(stake, input.teams),
    awayTeam: stake.game?.away_team ?? null,
    homeTeam: stake.game?.home_team ?? null,
    matchup: stake.game ? `${stake.game.away_team} @ ${stake.game.home_team}` : '',
    status,
    phase,
    progress,
    axisLabel,
    detail: isLegacyPick(stake) ? null : pickProgressLine(stake),
    legs: [],
  };
}

function legTeams(leg: PickCardStake): StakeTeam[] {
  if (!leg.game) return [];
  return [
    { teamId: leg.game.home_team_id, abbreviation: leg.game.home_team },
    { teamId: leg.game.away_team_id, abbreviation: leg.game.away_team },
  ];
}

function kickoffOf(leg: PickCardStake): number {
  const at = leg.game ? Date.parse(leg.game.scheduled_start) : Number.NaN;
  return Number.isFinite(at) ? at : Number.MAX_SAFE_INTEGER;
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
