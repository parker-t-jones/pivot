import type { Segment } from '@pivot/shared/picks';

import type { SpreadRole, TotalRole } from './addPickLine';
import type { Period } from './pickMarkets';

/**
 * Plain-English readouts for props and quarter/half lines, in the style of `spreadReadout`.
 * A whole-number line names the refunded tie; a half point does not. Never "push".
 */

function tieSentence(magnitude: number, what = `Exactly ${magnitude}`): string | null {
  return Number.isInteger(magnitude) ? `${what} is a tie, and the pick is refunded.` : null;
}

function join(base: string, ...extra: (string | null)[]): string {
  const rest = extra.filter((part): part is string => part != null && part.length > 0);
  return rest.length > 0 ? `${base}. ${rest.join(' ')}` : base;
}

const SEGMENT_NAME: Record<Segment, string> = {
  Q1: 'the 1st quarter',
  Q2: 'the 2nd quarter',
  Q3: 'the 3rd quarter',
  Q4: 'the 4th quarter',
  H1: 'the 1st half',
  H2: 'the 2nd half',
};

/** Q4 excludes overtime and H2 includes it (docs/P2-PICKS-MODEL.md §1). Say so where it matters. */
function overtimeNote(period: Period): string | null {
  if (period === 'Q4') return "Overtime doesn't count.";
  if (period === 'H2') return 'Overtime counts.';
  return null;
}

function inPeriod(period: Period): string {
  return period === null ? '' : ` in ${SEGMENT_NAME[period]}`;
}

function overCount(line: number): number {
  return Math.floor(line) + 1;
}

function underCount(line: number): number {
  return Math.ceil(line) - 1;
}

/** "Kittle needs 61 or more receiving yards". */
export function statReadout(name: string, role: TotalRole, line: number, unit: string): string {
  if (role === 'over') {
    return join(`${name} needs ${overCount(line)} or more ${unit}`, tieSentence(line));
  }
  const most = underCount(line);
  const base =
    most <= 0 ? `${name} needs to finish with 0 ${unit}` : `${name} needs ${most} or fewer ${unit}`;
  return join(base, tieSentence(line));
}

export function playerEventReadout(
  name: string,
  event: 'ANY_TD' | 'FIRST_TD',
  side: 'yes' | 'no',
): string {
  if (event === 'ANY_TD') {
    return side === 'yes'
      ? `${name} needs to score a touchdown.`
      : `${name} needs to finish without a touchdown.`;
  }
  return side === 'yes'
    ? `${name} needs to score the game's first touchdown.`
    : `${name} can't score the game's first touchdown.`;
}

export function teamTotalReadout(
  nickname: string,
  role: TotalRole,
  line: number,
  period: Period,
): string {
  const where = inPeriod(period);
  const most = underCount(line);
  const base =
    role === 'over'
      ? `${nickname} must score ${overCount(line)} or more points${where}`
      : most <= 0
        ? `${nickname} must score 0 points${where}`
        : `${nickname} must score ${most} or fewer points${where}`;
  return join(base, tieSentence(line), overtimeNote(period));
}

export function segmentTotalReadout(role: TotalRole, line: number, period: Segment): string {
  const where = SEGMENT_NAME[period];
  const most = underCount(line);
  const base =
    role === 'over'
      ? `Combined score in ${where} must be ${overCount(line)} or more`
      : most <= 0
        ? `Combined score in ${where} must be 0`
        : `Combined score in ${where} must be ${most} or fewer`;
  return join(base, tieSentence(line), overtimeNote(period));
}

/** Spread on one quarter or half, from the picked team's side. */
export function segmentSpreadReadout(
  nickname: string,
  role: SpreadRole,
  magnitude: number,
  period: Segment,
): string {
  const where = SEGMENT_NAME[period];
  if (role === 'favorite') {
    return join(
      `${nickname} must win ${where} by ${overCount(magnitude)} or more`,
      tieSentence(magnitude, `Winning ${where} by exactly ${magnitude}`),
      overtimeNote(period),
    );
  }
  const loseBy = underCount(magnitude);
  const base =
    loseBy <= 0
      ? `${nickname} must win or tie ${where}`
      : `${nickname} must lose ${where} by ${loseBy} or less, or win it`;
  return join(
    base,
    tieSentence(magnitude, `Losing ${where} by exactly ${magnitude}`),
    overtimeNote(period),
  );
}

/** `nickname` null: both teams together. */
export function fieldGoalReadout(
  nickname: string | null,
  role: TotalRole,
  line: number,
  period: Period,
): string {
  const who = nickname ?? 'The two teams';
  const where = inPeriod(period);
  const most = underCount(line);
  const base =
    role === 'over'
      ? `${who} must make ${overCount(line)} or more field goals${where}`
      : most <= 0
        ? `${who} must make no field goals${where}`
        : `${who} must make ${most} or fewer field goals${where}`;
  return join(base, tieSentence(line), overtimeNote(period));
}

export function firstToScoreReadout(nickname: string): string {
  return `${nickname} must score first.`;
}
