/**
 * Scoring for the bet slip import eval (#12). Pure, so it is unit tested; the runner is
 * `slip-import-eval.ts`.
 */
import type { SlipLeg, SlipRead } from '../services/api/src/lib/slipImport/schema.js';

/** The fields a reviewer writes in `<name>.expected.json`. Text and odds are not scored. */
export const SCORED_FIELDS = [
  'market',
  'stat',
  'player',
  'team',
  'side',
  'line',
  'plus_style',
  'period',
] as const;
export type ScoredField = (typeof SCORED_FIELDS)[number];

export type ExpectedLeg = Pick<SlipLeg, ScoredField>;

export interface ExpectedSlip {
  bet_count: number;
  legs: ExpectedLeg[];
}

export interface FieldTally {
  correct: number;
  total: number;
}

export interface EvalTally {
  slips: number;
  legCountCorrect: number;
  betCountCorrect: number;
  fields: Record<ScoredField, FieldTally>;
}

export function emptyTally(): EvalTally {
  const fields = Object.fromEntries(
    SCORED_FIELDS.map((field) => [field, { correct: 0, total: 0 }]),
  ) as Record<ScoredField, FieldTally>;
  return { slips: 0, legCountCorrect: 0, betCountCorrect: 0, fields };
}

/** Case, punctuation, and spacing don't count against a name: "A.J. Brown" equals "AJ Brown". */
function normalize(value: string | null): string | null {
  if (value === null) return null;
  return value
    .toLowerCase()
    .replace(/[.'’,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function same(field: ScoredField, got: SlipLeg | undefined, want: ExpectedLeg): boolean {
  if (got === undefined) return false;
  if (field === 'player' || field === 'team') return normalize(got[field]) === normalize(want[field]);
  return got[field] === want[field];
}

/**
 * Adds one slip to the tally. Legs are compared in printed order; a missing leg counts as wrong
 * on every field, so a dropped leg lowers every field's accuracy.
 */
export function scoreSlip(tally: EvalTally, got: SlipRead, want: ExpectedSlip): void {
  tally.slips += 1;
  if (got.legs.length === want.legs.length) tally.legCountCorrect += 1;
  if (got.bet_count === want.bet_count) tally.betCountCorrect += 1;
  want.legs.forEach((expected, index) => {
    for (const field of SCORED_FIELDS) {
      const entry = tally.fields[field];
      entry.total += 1;
      if (same(field, got.legs[index], expected)) entry.correct += 1;
    }
  });
}

export function formatTally(tally: EvalTally): string {
  const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`);
  const lines = [
    `slips: ${tally.slips}`,
    `leg count right: ${tally.legCountCorrect}/${tally.slips} (${pct(tally.legCountCorrect, tally.slips)})`,
    `bet count right: ${tally.betCountCorrect}/${tally.slips} (${pct(tally.betCountCorrect, tally.slips)})`,
    ...SCORED_FIELDS.map((field) => {
      const { correct, total } = tally.fields[field];
      return `${field.padEnd(10)} ${correct}/${total} (${pct(correct, total)})`;
    }),
  ];
  return lines.join('\n');
}
