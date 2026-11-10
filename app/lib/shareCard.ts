import type { PickCardModel } from './pickCard';
import type { WeekCardModel } from './weekCardModel';

export interface ShareRow {
  label: string;
  value: string;
  note?: string;
}

export interface ShareContent {
  kind: 'week' | 'pick';
  title: string;
  subtitle: string | null;
  rows: ShareRow[];
  /** Pivot's own mark, with the week when known. Never an email, name, or internal ID. */
  footer: string;
}

const BRAND = 'PIVOT';

/**
 * Content for a shared image of the Watchlist week card (issue #48). Pulled from the same
 * `WeekCardModel` the live card renders, so the shared image can never show something the
 * card itself doesn't — just the week, the game count, and the four cells.
 */
export function weekCardShareContent(model: WeekCardModel): ShareContent {
  return {
    kind: 'week',
    title: model.eyebrow,
    subtitle: model.gameCountLabel,
    rows: [model.fantasy, model.opponent, model.bets, model.pools].map((cell) => ({
      label: cell.label,
      value: cell.value,
      ...(cell.note !== undefined ? { note: cell.note } : {}),
    })),
    footer: BRAND,
  };
}

/**
 * Content for a shared image of a single pick card. Not wired into the UI yet (issue #48 scoped
 * the Share button to the week card only; see the PR description) but kept ready, and tested,
 * for that follow-up.
 */
export function pickCardShareContent(model: PickCardModel, week: number | null): ShareContent {
  const rows: ShareRow[] = [{ label: model.eyebrow, value: model.pick }];
  if (model.detail) rows.push({ label: 'Detail', value: model.detail });
  rows.push({ label: 'Status', value: model.status });
  return {
    kind: 'pick',
    title: model.pick,
    subtitle: model.matchup.length > 0 ? model.matchup : null,
    rows,
    footer: week == null ? BRAND : `${BRAND} · WEEK ${week}`,
  };
}
