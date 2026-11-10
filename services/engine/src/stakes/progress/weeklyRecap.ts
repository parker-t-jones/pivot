import type { SettledResult, StakeCondition } from '@pivot/shared';

/**
 * Weekly recap (docs/P2-PICKS-MODEL.md §5, issue #47). Aggregates already-settled picks: rows
 * with a non-null `stakes.result`. Fantasy rows (`ROSTERED` / `OPPONENT_ROSTERED`) never settle
 * (`pickProgress` always returns `unavailable` for them — confirmed in `pickProgress.ts` and
 * `settlePicks.ts`, which only settles bet-condition rows), so they never reach this function; the
 * API route filters them out before calling it, the same way `GET /picks` already does.
 */

export interface RecapPickRow {
  id: string;
  condition: StakeCondition;
  result: SettledResult;
  /** `stakes.result_value`: the stat, points, or signed margin at settlement. */
  resultValue: number | null;
}

export interface WeeklyRecapTotals {
  /** Settled bet-condition picks for the week (parlay legs count individually). */
  picksMade: number;
  won: number;
  lost: number;
  tie: number;
  voided: number;
  /** `won + lost`: the hit-rate denominator. Ties and voids don't count either way. */
  decided: number;
  /** `won / decided`, or `null` with nothing decided yet. */
  hitRate: number | null;
  /** The won pick with the largest margin. `null` with no wins. */
  bestPickId: string | null;
  /** The lost pick with the largest margin against it. `null` with no losses. */
  worstPickId: string | null;
}

export interface SeasonHitRate {
  won: number;
  decided: number;
  hitRate: number | null;
}

/**
 * How decisively a settled pick cleared or missed its line, signed so that winning further past
 * the line (or losing further past it) is a larger number. `null` when the condition has no line
 * to measure against (`FIRST_TO_SCORE`, `PLAYER_EVENT` with `event: 'FIRST_TD'`) — those picks are
 * never chosen as best/worst over one that does carry a margin.
 */
export function pickMargin(condition: StakeCondition, resultValue: number | null): number | null {
  if (resultValue === null) return null;
  switch (condition.type) {
    case 'STAT_OVER':
    case 'TOTAL_OVER':
    case 'TEAM_TOTAL_OVER':
    case 'FG_OVER':
      return resultValue - condition.line;
    case 'STAT_UNDER':
    case 'TOTAL_UNDER':
    case 'TEAM_TOTAL_UNDER':
    case 'FG_UNDER':
      return condition.line - resultValue;
    case 'PLAYER_EVENT':
      // Only the ANY_TD count carries a resultValue; FIRST_TD never does (pickProgress.ts).
      return resultValue - 0.5;
    case 'SPREAD':
    case 'MONEYLINE':
    case 'SURVIVOR':
      // Already a signed margin from the subject's perspective (pickProgress.ts marginResult).
      return resultValue;
    default:
      return null;
  }
}

/** Aggregates one week's settled picks for one user. `rows` should already be one user, one week. */
export function weeklyRecap(rows: readonly RecapPickRow[]): WeeklyRecapTotals {
  let won = 0;
  let lost = 0;
  let tie = 0;
  let voided = 0;
  let best: { id: string; margin: number } | null = null;
  let worst: { id: string; margin: number } | null = null;

  for (const row of rows) {
    const margin = pickMargin(row.condition, row.resultValue) ?? 0;
    switch (row.result) {
      case 'won':
        won += 1;
        if (best === null || margin > best.margin) best = { id: row.id, margin };
        break;
      case 'lost':
        lost += 1;
        if (worst === null || margin < worst.margin) worst = { id: row.id, margin };
        break;
      case 'tie':
        tie += 1;
        break;
      case 'void':
        voided += 1;
        break;
    }
  }

  const decided = won + lost;
  return {
    picksMade: rows.length,
    won,
    lost,
    tie,
    voided,
    decided,
    hitRate: decided > 0 ? won / decided : null,
    bestPickId: best?.id ?? null,
    worstPickId: worst?.id ?? null,
  };
}

/** Season-to-date hit rate over every settled row passed in (typically every week up to and including this one). */
export function seasonHitRate(rows: readonly { result: SettledResult }[]): SeasonHitRate {
  let won = 0;
  let lost = 0;
  for (const row of rows) {
    if (row.result === 'won') won += 1;
    else if (row.result === 'lost') lost += 1;
  }
  const decided = won + lost;
  return { won, decided, hitRate: decided > 0 ? won / decided : null };
}
