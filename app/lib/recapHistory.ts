import type { RecapPage, RecapPickSummary, RecapWeek, RecapWeekTotals } from './picksClient';

/** Pure view model for the Recap screen (issue #47). Built from `GET /picks/recap`. */

export type RecapResultLabel = 'Won' | 'Lost' | 'Tie' | 'Refunded';

export interface RecapPickLine {
  id: string;
  /** "J. Gibbs over 120.5 rush + rec yds", with "· Parlay leg" on a leg. */
  label: string;
  resultLabel: RecapResultLabel;
  tone: 'won' | 'lost' | 'neutral';
}

export interface RecapWeekModel {
  week: number;
  /** "WEEK 10" */
  eyebrow: string;
  /** "1 of 2 hit (50%)", or a ties-and-refunds line when nothing was won or lost. */
  weekLine: string;
  /** "J. Gibbs over 120.5 rush + rec yds · Won" */
  bestLabel: string | null;
  /** "DET -3.5 · Lost" */
  worstLabel: string | null;
  /** Every settled pick that week, oldest first. Empty from an API build without history. */
  picks: RecapPickLine[];
}

export interface RecapHistoryModel {
  /** True when nothing has been graded all season. */
  isEmpty: boolean;
  /** "9 of 14 hit this season (64%)" */
  seasonLine: string;
  /** Most recent first. */
  weeks: RecapWeekModel[];
}

function pct(hitRate: number | null): string {
  return hitRate === null ? '' : ` (${Math.round(hitRate * 100)}%)`;
}

/** User copy never says "push" for a tie (it collides with push notifications). */
export function recapResultLabel(result: RecapPickSummary['result']): RecapResultLabel {
  switch (result) {
    case 'won':
      return 'Won';
    case 'lost':
      return 'Lost';
    case 'tie':
      return 'Tie';
    case 'void':
      return 'Refunded';
  }
}

function pickLine(pick: RecapPickSummary | null, verb: 'Won' | 'Lost'): string | null {
  if (pick === null || pick.label.length === 0) return null;
  return `${pick.label} · ${verb}`;
}

function weekLine(totals: RecapWeekTotals): string {
  if (totals.decided > 0) return `${totals.won} of ${totals.decided} hit${pct(totals.hit_rate)}`;
  return totals.picks_made === 1
    ? '1 pick, tied or refunded'
    : `${totals.picks_made} picks, all tied or refunded`;
}

function weekModel(week: RecapWeek): RecapWeekModel {
  return {
    week: week.week,
    eyebrow: `WEEK ${week.week}`,
    weekLine: weekLine(week),
    bestLabel: pickLine(week.best, 'Won'),
    worstLabel: pickLine(week.worst, 'Lost'),
    picks: week.picks
      .filter((pick) => pick.label.length > 0)
      .map(
        (pick): RecapPickLine => ({
          id: pick.id,
          label: pick.slip_id ? `${pick.label} · Parlay leg` : pick.label,
          resultLabel: recapResultLabel(pick.result),
          tone: pick.result === 'won' ? 'won' : pick.result === 'lost' ? 'lost' : 'neutral',
        }),
      ),
  };
}

/**
 * An API build without `weeks` still returns this week's totals and best/worst; show that one week
 * (without the full pick list) until the API catches up.
 */
function fallbackWeeks(page: RecapPage): RecapWeek[] {
  if (page.week_recap.picks_made === 0) return [];
  return [{ ...page.week_recap, week: page.week, picks: [] }];
}

export function recapHistoryModel(page: RecapPage): RecapHistoryModel {
  const weeks = (page.weeks ?? fallbackWeeks(page)).filter((week) => week.picks_made > 0);
  const season = page.season_recap;
  return {
    isEmpty: weeks.length === 0,
    seasonLine:
      season.decided > 0
        ? `${season.won} of ${season.decided} hit this season${pct(season.hit_rate)}`
        : 'No picks won or lost this season yet.',
    weeks: weeks.map(weekModel),
  };
}
