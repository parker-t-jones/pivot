import type { PickKind } from './addPickFlow';

/** The picked team's role. The stored line stays attached to that team. */
export type SpreadRole = 'favorite' | 'underdog';
export type TotalRole = 'over' | 'under';

/**
 * Spread magnitude the stepper will stop at. The field is the absolute value;
 * favorite sends it negative and underdog sends it positive, matching the old
 * minus / plus toggle. A zero spread is a moneyline, so the floor is a half
 * point. Totals stay inside the API's 10–100 range.
 */
export const SPREAD_LINE_BOUNDS = { min: 0.5, max: 50 } as const;
export const TOTAL_LINE_BOUNDS = { min: 10, max: 100 } as const;

/** Shown as a placeholder, and the number an untouched field steps from. */
export const SPREAD_LINE_BASELINE = 3.5;
export const TOTAL_LINE_BASELINE = 44.5;

export function lineBounds(kind: 'SPREAD' | 'TOTAL'): { min: number; max: number } {
  return kind === 'SPREAD' ? SPREAD_LINE_BOUNDS : TOTAL_LINE_BOUNDS;
}

export function lineBaseline(kind: 'SPREAD' | 'TOTAL'): number {
  return kind === 'SPREAD' ? SPREAD_LINE_BASELINE : TOTAL_LINE_BASELINE;
}

/** What `validateLine` received from the old sign toggle, for the same bet. */
export function spreadLineInput(role: SpreadRole, magnitude: string): string {
  const digits = magnitude.trim().replace(/^[+\u2212-]/, '');
  if (digits.length === 0) return '';
  return role === 'favorite' ? `-${digits}` : `+${digits}`;
}

export function formatMagnitude(value: number): string {
  const snapped = Math.round(value * 2) / 2;
  return Number.isInteger(snapped) ? String(snapped) : snapped.toFixed(1);
}

/**
 * Move the magnitude by half a point and keep it inside the type's range.
 * An empty field is still the placeholder, so the first tap steps from `baseline`.
 */
export function stepMagnitude(
  current: string,
  direction: 1 | -1,
  bounds: { min: number; max: number },
  baseline: number,
): string {
  const parsed = Number(current);
  const hasValue = current.trim().length > 0 && Number.isFinite(parsed);
  const start = hasValue ? parsed : baseline;
  const next = Math.round((start + direction * 0.5) * 2) / 2;
  const clamped = Math.min(bounds.max, Math.max(bounds.min, next));
  return formatMagnitude(clamped);
}

function whole(value: number): boolean {
  return Number.isInteger(value);
}

function withTie(base: string, tie: string, magnitude: number): string {
  return whole(magnitude) ? `${base}. ${tie}` : base;
}

/** Plain-English spread. A whole number names the refunded tie; a half point does not. */
export function spreadReadout(nickname: string, role: SpreadRole, magnitude: number): string {
  if (magnitude === 0) {
    return role === 'favorite'
      ? `${nickname} must win. A tie refunds the pick.`
      : `${nickname} can tie or win.`;
  }
  if (role === 'favorite') {
    const winBy = Math.floor(magnitude) + 1;
    return withTie(
      `${nickname} must win by ${winBy} or more`,
      `Winning by exactly ${magnitude} is a tie, and the pick is refunded.`,
      magnitude,
    );
  }
  const loseBy = Math.ceil(magnitude) - 1;
  return withTie(
    `${nickname} must lose by ${loseBy} or less, or win`,
    `Losing by exactly ${magnitude} is a tie, and the pick is refunded.`,
    magnitude,
  );
}

/** Plain-English total. A whole number names the refunded tie; a half point does not. */
export function totalReadout(role: TotalRole, magnitude: number): string {
  if (role === 'over') {
    const need = Math.floor(magnitude) + 1;
    return withTie(
      `Combined score must be ${need} or more`,
      `Exactly ${magnitude} is a tie, and the pick is refunded.`,
      magnitude,
    );
  }
  const fewer = Math.ceil(magnitude) - 1;
  return withTie(
    `Combined score must be ${fewer} or fewer`,
    `Exactly ${magnitude} is a tie, and the pick is refunded.`,
    magnitude,
  );
}

/** Free accounts only. Pro and an unknown count stay quiet. */
export function addPickReviewNote(
  kind: PickKind,
  allowance: { isPro: boolean; freeLeft: number | null },
): string | null {
  if (allowance.isPro || allowance.freeLeft == null) return null;
  if (kind === 'SURVIVOR') return "Doesn't use a free bet";
  if (allowance.freeLeft <= 0) return null;
  return `Uses 1 of your ${allowance.freeLeft} free bets`;
}
