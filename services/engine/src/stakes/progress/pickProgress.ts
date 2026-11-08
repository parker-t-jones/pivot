import type { GamePlayerStats, PickProgress, Segment } from '@pivot/shared';
import type { EvaluatorContext, Stake } from '../types.js';
import { firstTouchdown } from './firstTd.js';
import { matchPlayer } from './playerMatch.js';
import {
  gameIsFinal,
  periodInSegment,
  segmentComplete,
  segmentPoints,
  segmentStarted,
  sideOf,
} from './segment.js';

/** What `pickProgress` reads. A subset of `EvaluatorContext`, so the API can call it too. */
export type ProgressContext = Pick<EvaluatorContext, 'game' | 'playerStats' | 'player'>;

/**
 * Smallest whole value that clears an over (`floor(line) + 1`), minus the current value.
 * 89.5 at 78 is 12; 90 at 78 is 13. Never negative.
 */
export function neededForOver(current: number, line: number): number {
  return Math.max(0, Math.floor(line) + 1 - current);
}

/** Room left under an under before it loses or ties (`ceil(line) − 1 − current`). Never negative. */
export function roomUnder(current: number, line: number): number {
  return Math.max(0, Math.ceil(line) - 1 - current);
}

/**
 * Over/under status. During play an over that has cleared is `hit` and an under that went over is
 * `missed`; everything else is `live`. Once `decided` (game or segment over), it is won/lost/tie.
 */
export function overUnder(
  side: 'OVER' | 'UNDER',
  current: number,
  line: number,
  decided: boolean,
): PickProgress {
  const over = current > line;
  const exact = current === line;
  if (decided) {
    const status = exact ? 'tie' : over === (side === 'OVER') ? 'won' : 'lost';
    return { status, current, line, needed: 0 };
  }
  if (side === 'OVER') {
    return over
      ? { status: 'hit', current, line, needed: 0 }
      : { status: 'live', current, line, needed: neededForOver(current, line) };
  }
  return over
    ? { status: 'missed', current, line, needed: 0 }
    : { status: 'live', current, line, needed: roomUnder(current, line) };
}

/** Margin result for a side: positive wins, zero ties. */
function marginResult(margin: number, decided: boolean): PickProgress {
  if (!decided) return { status: 'live', current: margin };
  return { status: margin > 0 ? 'won' : margin < 0 ? 'lost' : 'tie', current: margin };
}

function fieldGoals(
  stats: GamePlayerStats | undefined,
  teamId: string | null,
  segment: Segment | undefined,
): number {
  return (stats?.scoringPlays ?? []).filter(
    (play) =>
      play.kind === 'FG' &&
      (teamId === null || play.teamId === teamId) &&
      periodInSegment(play.period, segment),
  ).length;
}

function playerProgress(stake: Stake, ctx: ProgressContext): PickProgress {
  const { game, playerStats: stats, player } = ctx;
  if (stake.subject.type !== 'PLAYER') return { status: 'unavailable' };
  if (player === undefined || player.playerId !== stake.subject.playerId) {
    return { status: 'unavailable' };
  }
  if (stats === undefined) return { status: game.status === 'final' ? 'unavailable' : 'pending' };

  const final = gameIsFinal(game, stats);
  const condition = stake.condition;

  if (condition.type === 'PLAYER_EVENT' && condition.event === 'FIRST_TD') {
    const match = matchPlayer(player, stats);
    if (match.kind === 'unmatched') return { status: 'unavailable' };
    if (final && match.kind === 'absent') return { status: 'void' };
    const first = firstTouchdown(stats);
    if (first.kind === 'unknown') return { status: 'unavailable' };
    if (first.kind === 'none') {
      if (!final) return { status: 'live' };
      return { status: condition.side === 'YES' ? 'lost' : 'won' };
    }
    const scored = first.espnId === match.espnId;
    const favorable = scored === (condition.side === 'YES');
    if (final) return { status: favorable ? 'won' : 'lost' };
    return { status: favorable ? 'hit' : 'missed' };
  }

  const match = matchPlayer(player, stats);
  if (match.kind === 'unmatched') return { status: 'unavailable' };
  if (match.kind === 'absent') {
    if (final) return { status: 'void' };
    if (!segmentStarted(undefined, game)) return { status: 'pending' };
  }
  const line = match.kind === 'found' ? match.line : undefined;

  if (condition.type === 'PLAYER_EVENT') {
    const tds = line?.stats.ANY_TD ?? 0;
    return overUnder(condition.side === 'YES' ? 'OVER' : 'UNDER', tds, 0.5, final);
  }
  if (condition.type === 'STAT_OVER' || condition.type === 'STAT_UNDER') {
    if (!segmentStarted(undefined, game)) return { status: 'pending' };
    const current = line?.stats[condition.stat] ?? 0;
    return overUnder(
      condition.type === 'STAT_OVER' ? 'OVER' : 'UNDER',
      current,
      condition.line,
      final,
    );
  }
  return { status: 'unavailable' };
}

function teamOrGameProgress(stake: Stake, ctx: ProgressContext): PickProgress {
  const { game, playerStats: stats } = ctx;
  const condition = stake.condition;
  const segment = 'segment' in condition ? condition.segment : undefined;
  if (!segmentStarted(segment, game)) return { status: 'pending' };
  const decided = segmentComplete(segment, game, stats);
  const final = gameIsFinal(game, stats);

  const teamId = stake.subject.type === 'TEAM' ? stake.subject.teamId : null;
  const side = teamId === null ? null : sideOf(game, teamId);
  if (teamId !== null && side === null) return { status: 'unavailable' };

  switch (condition.type) {
    case 'MONEYLINE':
    case 'SURVIVOR':
    case 'SPREAD': {
      if (side === null) return { status: 'unavailable' };
      const mine = segmentPoints(side, segment, game, stats);
      const theirs = segmentPoints(side === 'home' ? 'away' : 'home', segment, game, stats);
      const line = condition.type === 'SPREAD' ? condition.line : 0;
      return marginResult(mine - theirs + line, decided);
    }
    case 'TOTAL_OVER':
    case 'TOTAL_UNDER': {
      const total =
        segmentPoints('home', segment, game, stats) + segmentPoints('away', segment, game, stats);
      return overUnder(
        condition.type === 'TOTAL_OVER' ? 'OVER' : 'UNDER',
        total,
        condition.line,
        decided,
      );
    }
    case 'TEAM_TOTAL_OVER':
    case 'TEAM_TOTAL_UNDER': {
      if (side === null) return { status: 'unavailable' };
      return overUnder(
        condition.type === 'TEAM_TOTAL_OVER' ? 'OVER' : 'UNDER',
        segmentPoints(side, segment, game, stats),
        condition.line,
        decided,
      );
    }
    case 'FG_OVER':
    case 'FG_UNDER': {
      if (stats === undefined) return { status: 'pending' };
      return overUnder(
        condition.type === 'FG_OVER' ? 'OVER' : 'UNDER',
        fieldGoals(stats, teamId, segment),
        condition.line,
        decided,
      );
    }
    case 'FIRST_TO_SCORE': {
      if (teamId === null) return { status: 'unavailable' };
      const first = stats?.scoringPlays[0];
      if (first === undefined) {
        // A scoreless game has no first scorer: no action.
        if (final)
          return { status: game.scoreHome + game.scoreAway === 0 ? 'void' : 'unavailable' };
        return { status: stats === undefined ? 'pending' : 'live' };
      }
      const mine = first.teamId === teamId;
      if (final) return { status: mine ? 'won' : 'lost' };
      return { status: mine ? 'hit' : 'missed' };
    }
    default:
      return { status: 'unavailable' };
  }
}

/**
 * Pure progress for one pick (docs/P2-PICKS-MODEL.md §5). Fantasy rows have no progress. In-app
 * only: anything pushed from this goes through reveal timing.
 */
export function pickProgress(stake: Stake, ctx: ProgressContext): PickProgress {
  const type = stake.condition.type;
  if (type === 'ROSTERED' || type === 'OPPONENT_ROSTERED') return { status: 'unavailable' };
  if (ctx.game.status === 'scheduled') return { status: 'pending' };
  if (type === 'STAT_OVER' || type === 'STAT_UNDER' || type === 'PLAYER_EVENT') {
    return playerProgress(stake, ctx);
  }
  return teamOrGameProgress(stake, ctx);
}

/** A pick that can't change any more during play. `live` and `pending` are the only open states. */
export function isDecided(progress: PickProgress): boolean {
  return progress.status !== 'live' && progress.status !== 'pending';
}
