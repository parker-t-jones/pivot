import type { PickProgress, SlipSummary } from '@pivot/shared/picks';

/**
 * In-app progress copy for props, quarter and half lines, and parlays (docs/P2-PICKS-MODEL.md
 * §5–§6). `GET /picks` reads the same live, unheld snapshot Home's scores use, so this is never
 * pushed. A tie or a player who did not play reads "refunded", never "push".
 */

const STAT_UNITS: Record<string, string> = {
  PASS_YDS: 'pass yds',
  PASS_COMP: 'completions',
  PASS_ATT: 'pass attempts',
  PASS_TD: 'pass TDs',
  INT_THROWN: 'INTs',
  RUSH_YDS: 'rush yds',
  RUSH_ATT: 'rush attempts',
  REC_YDS: 'rec yds',
  RECEPTIONS: 'receptions',
  ANY_TD: 'TDs',
  FG_MADE: 'FGs',
  KICK_PTS: 'kicking pts',
};

/** The four pre-props types with no quarter or half. Their cards keep the score bar instead. */
const LEGACY_TYPES = new Set(['SPREAD', 'TOTAL_OVER', 'TOTAL_UNDER', 'MONEYLINE', 'SURVIVOR']);

export interface ProgressPick {
  condition: { type: string; stat?: string; segment?: string };
  progress?: PickProgress;
}

/** True for a pick the old cards already describe (no progress line). */
export function isLegacyPick(pick: { condition: { type: string; segment?: string } }): boolean {
  return LEGACY_TYPES.has(pick.condition.type) && pick.condition.segment === undefined;
}

function unitFor(condition: ProgressPick['condition']): string | null {
  switch (condition.type) {
    case 'STAT_OVER':
    case 'STAT_UNDER':
      return STAT_UNITS[condition.stat ?? ''] ?? null;
    case 'TEAM_TOTAL_OVER':
    case 'TEAM_TOTAL_UNDER':
    case 'TOTAL_OVER':
    case 'TOTAL_UNDER':
      return 'pts';
    case 'FG_OVER':
    case 'FG_UNDER':
      return 'FGs';
    default:
      return null;
  }
}

function isUnder(type: string): boolean {
  return type.endsWith('_UNDER');
}

function withCurrent(word: string, pick: ProgressPick): string {
  const current = pick.progress?.current;
  const unit = unitFor(pick.condition);
  return typeof current === 'number' && unit ? `${word} · ${current} ${unit}` : word;
}

/** One line under the pick, or null when there is nothing to say yet. */
export function pickProgressLine(pick: ProgressPick): string | null {
  const progress = pick.progress;
  if (!progress) return null;
  const type = pick.condition.type;
  switch (progress.status) {
    case 'pending':
      return null;
    case 'unavailable':
      return 'Stats unavailable';
    case 'void':
      return 'Refunded · did not play';
    case 'tie':
      return withCurrent('Tie · refunded', pick);
    case 'won':
      return withCurrent('Won', pick);
    case 'lost':
      return withCurrent('Lost', pick);
    case 'hit':
      return withCurrent('Hit', pick);
    case 'missed':
      return withCurrent('Missed', pick);
    case 'live':
      break;
  }

  if (type === 'FIRST_TO_SCORE') return 'No score yet';
  if (type === 'SPREAD' || type === 'MONEYLINE' || type === 'SURVIVOR') {
    const margin = progress.current;
    if (typeof margin !== 'number') return null;
    if (margin > 0) return `Covering by ${margin}`;
    if (margin < 0) return `Short by ${-margin}`;
    return 'Even with the line';
  }
  const unit = unitFor(pick.condition);
  if (unit === null || typeof progress.current !== 'number') return null;
  const now = `${progress.current} ${unit}`;
  if (typeof progress.needed !== 'number') return now;
  return isUnder(type)
    ? `${now} · ${progress.needed} to spare`
    : `${now} · ${progress.needed} to go`;
}

/** A short state for one parlay leg. */
export function legStateLabel(progress: PickProgress | undefined): string | null {
  switch (progress?.status) {
    case 'live':
      return 'Live';
    case 'hit':
      return 'Hit';
    case 'missed':
      return 'Missed';
    case 'won':
      return 'Won';
    case 'lost':
      return 'Lost';
    case 'tie':
    case 'void':
      return 'Refunded';
    case 'unavailable':
      return 'No stats';
    default:
      return null;
  }
}

/** The parlay's line: how many legs have hit and how many are still open. */
export function parlaySummaryLine(summary: SlipSummary | undefined): string | null {
  if (!summary) return null;
  const refunded = summary.refunded > 0 ? ` · ${summary.refunded} refunded` : '';
  switch (summary.status) {
    case 'pending':
      return null;
    case 'won':
      return `Won${refunded}`;
    case 'lost':
      return `Lost · ${summary.lost} of ${summary.legs} legs missed`;
    case 'void':
      return 'Refunded';
    case 'live':
      return `${summary.hit} of ${summary.legs - summary.refunded} legs hit · ${summary.alive} still open${refunded}`;
  }
}
