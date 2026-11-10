import type { RecapPage, RecapPickSummary } from './picksClient';

/** Pure view model for `RecapCard` (issue #47). Built from `GET /picks/recap`. */
export interface RecapCardModel {
  week: number;
  /** True when nothing has been graded yet this week — new account, or a week with no picks. */
  isEmpty: boolean;
  /** "3 of 5 hit", or null with nothing decided yet (all void/tie, or no picks at all). */
  weekLine: string | null;
  bestLabel: string | null;
  worstLabel: string | null;
  /** "9 of 14 hit this season", or null with nothing decided all season. */
  seasonLine: string | null;
}

function pct(hitRate: number | null): string {
  return hitRate === null ? '' : ` (${Math.round(hitRate * 100)}%)`;
}

function pickLine(pick: RecapPickSummary | null, verb: 'Won' | 'Lost'): string | null {
  if (pick === null || pick.label.length === 0) return null;
  return `${pick.label} · ${verb}`;
}

export function recapCardModel(page: RecapPage): RecapCardModel {
  const { week_recap: weekRecap, season_recap: seasonRecap } = page;
  return {
    week: page.week,
    isEmpty: weekRecap.picks_made === 0,
    weekLine:
      weekRecap.decided > 0
        ? `${weekRecap.won} of ${weekRecap.decided} hit${pct(weekRecap.hit_rate)}`
        : null,
    bestLabel: pickLine(weekRecap.best, 'Won'),
    worstLabel: pickLine(weekRecap.worst, 'Lost'),
    seasonLine:
      seasonRecap.decided > 0
        ? `${seasonRecap.won} of ${seasonRecap.decided} hit this season${pct(seasonRecap.hit_rate)}`
        : null,
  };
}
