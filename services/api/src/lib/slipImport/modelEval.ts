/**
 * Multi-model comparison for the bet slip reader eval (#41): runs the same image set through
 * several candidate models and scores + costs each independently. The runner
 * (`services/api/src/slipModelEval.ts`) wires this to the real Anthropic API; this module is
 * pure except for the injected `ModelReader`, so it is unit tested without spending money.
 */
import {
  emptyTally,
  formatTally,
  scoreSlip,
  scoreUnordered,
  fieldAccuracy,
  wrongFields,
  type EvalTally,
  type ExpectedSlip,
} from './evalScore.js';
import { costForUsage, MODEL_PRICING, type ModelPricing, type TokenUsage } from './modelCost.js';
import type { SlipImage } from './reader.js';
import type { SlipRead } from './schema.js';

export interface ModelCandidate {
  model: string;
  label: string;
}

/**
 * The three models #41 asks to compare. Pick current ones; update here (and in
 * `modelCost.ts`'s pricing table) if Anthropic ships a newer generation before this runs.
 */
export const MODEL_CANDIDATES: ModelCandidate[] = [
  { model: 'claude-opus-5-5', label: 'Opus 5.5' },
  { model: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { model: 'claude-haiku-5-5', label: 'Haiku 5.5' },
];

export interface ImageCase {
  name: string;
  image: SlipImage;
  expected: ExpectedSlip;
  unverified?: boolean;
}

export interface ReadFailure {
  name: string;
  message: string;
}

export type ModelReader = (
  model: string,
  image: SlipImage,
) => Promise<{ read: SlipRead; usage: TokenUsage | null }>;

export interface ModelEvalResult {
  model: string;
  label: string;
  tally: EvalTally;
  totalCost: number;
  costPerImage: number;
  failures: ReadFailure[];
  unordered: EvalTally;
  records: EvalRecord[];
  runStats: { fieldAccuracy: Stats; unorderedAccuracy: Stats; cost: Stats };
}

export interface EvalRecord {
  name: string;
  model: string;
  run: number;
  latencyMs: number;
  usage: TokenUsage | null;
  cost: number | null;
  failure: string | null;
  wrong: ReturnType<typeof wrongFields>;
  scored: boolean;
  slipWrong: { field: string; expected: number | boolean; got: number | boolean }[];
  counts: { expected: number; got: number };
  read: SlipRead;
}
export interface Stats {
  mean: number;
  min: number;
  max: number;
}
function stats(values: number[]): Stats {
  return {
    mean: values.reduce((a, b) => a + b, 0) / (values.length || 1),
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
  };
}
export interface EvalOptions {
  runs?: number;
  prices?: Record<string, ModelPricing>;
}

/** A read that fails (upstream error, refusal, unparseable answer) scores as a non-slip with no
 *  legs, same as the single-model runner — a dropped read should look just as wrong as a dropped
 *  leg, not vanish from the tally. */
export async function evalModel(
  candidate: ModelCandidate,
  cases: ImageCase[],
  read: ModelReader,
  options: EvalOptions = {},
): Promise<ModelEvalResult> {
  const runs = options.runs ?? 1;
  if (!Number.isSafeInteger(runs) || runs < 1) throw new Error('runs must be a positive integer');
  const prices = options.prices ?? MODEL_PRICING;
  costForUsage(candidate.model, { input_tokens: 0, output_tokens: 0 }, prices);
  const tally = emptyTally(),
    unordered = emptyTally();
  const failures: ReadFailure[] = [],
    records: EvalRecord[] = [];
  const accuracies: number[] = [],
    unorderedAccuracies: number[] = [],
    costs: number[] = [];
  let totalCost = 0;
  for (let run = 1; run <= runs; run++) {
    const runTally = emptyTally(),
      runUnordered = emptyTally();
    let runCost = 0;
    for (const { name, image, expected, unverified } of cases) {
      const start = performance.now();
      let got: SlipRead = { is_bet_slip: false, bet_count: 0, legs: [] };
      let usage: TokenUsage | null = null,
        cost: number | null = null,
        failure: string | null = null;
      try {
        const result = await read(candidate.model, image);
        got = result.read;
        usage = result.usage;
        cost = usage === null ? null : costForUsage(candidate.model, usage, prices);
        runCost += cost ?? 0;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        failures.push({ name, message: failure });
      }
      const latencyMs = performance.now() - start;
      if (!unverified) {
        scoreSlip(tally, got, expected);
        scoreSlip(runTally, got, expected);
        scoreUnordered(unordered, got, expected);
        scoreUnordered(runUnordered, got, expected);
      }
      records.push({
        name,
        model: candidate.model,
        run,
        latencyMs,
        usage,
        cost,
        failure,
        wrong: unverified ? [] : wrongFields(got, expected),
        scored: !unverified,
        slipWrong: unverified
          ? []
          : [
              { field: 'leg_count', expected: expected.legs.length, got: got.legs.length },
              { field: 'bet_count', expected: expected.bet_count, got: got.bet_count },
              {
                field: 'is_bet_slip',
                expected: expected.is_bet_slip ?? true,
                got: got.is_bet_slip,
              },
            ].filter((f) => f.expected !== f.got),
        counts: { expected: expected.legs.length, got: got.legs.length },
        read: got,
      });
    }
    totalCost += runCost;
    costs.push(runCost);
    accuracies.push(fieldAccuracy(runTally));
    unorderedAccuracies.push(fieldAccuracy(runUnordered));
  }
  return {
    model: candidate.model,
    label: candidate.label,
    tally,
    unordered,
    totalCost,
    costPerImage: cases.length ? totalCost / (cases.length * runs) : 0,
    failures,
    records,
    runStats: {
      fieldAccuracy: stats(accuracies),
      unorderedAccuracy: stats(unorderedAccuracies),
      cost: stats(costs),
    },
  };
}

export async function evalModels(
  candidates: ModelCandidate[],
  cases: ImageCase[],
  read: ModelReader,
  options: EvalOptions = {},
): Promise<ModelEvalResult[]> {
  // Validate every price before spending money on even the first model.
  for (const candidate of candidates)
    costForUsage(
      candidate.model,
      { input_tokens: 0, output_tokens: 0 },
      options.prices ?? MODEL_PRICING,
    );
  const results: ModelEvalResult[] = [];
  for (const candidate of candidates)
    results.push(await evalModel(candidate, cases, read, options));
  return results;
}

export function formatModelEvalResult(result: ModelEvalResult): string {
  const lines = [
    `## ${result.label} (\`${result.model}\`)`,
    '',
    'Positional:',
    formatTally(result.tally),
    'Order-insensitive (best assignment):',
    formatTally(result.unordered),
    ...Object.entries(result.runStats).map(
      ([key, s]) =>
        `${key} per-run mean/min/max: ${s.mean.toFixed(6)} / ${s.min.toFixed(6)} / ${s.max.toFixed(6)}`,
    ),
    ...(result.records.some((r) => r.cost === null)
      ? ['Some costs/tokens are unknown; totals include known usage only.']
      : []),
    '',
    `cost: $${result.totalCost.toFixed(4)} total, $${result.costPerImage.toFixed(4)}/image`,
  ];
  if (result.failures.length > 0) {
    lines.push('', 'read failures:', ...result.failures.map((f) => `- ${f.name}: ${f.message}`));
  }
  return lines.join('\n');
}

/** A compact side-by-side table, for pasting into `docs/SLIP-MODEL-EVAL.md`. */
export function formatComparisonTable(results: ModelEvalResult[]): string {
  const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`);
  const header =
    '| model | leg count | bet count | is_bet_slip | field accuracy (positional / best assignment) | $/image |';
  const sep = '|---|---|---|---|---|---|';
  const rows = results.map((r) => {
    const { tally } = r;
    const fieldEntries = Object.values(tally.fields);
    const fieldCorrect = fieldEntries.reduce((sum, f) => sum + f.correct, 0);
    const fieldTotal = fieldEntries.reduce((sum, f) => sum + f.total, 0);
    return [
      `| ${r.label} (\`${r.model}\`)`,
      pct(tally.legCountCorrect, tally.slips),
      pct(tally.betCountCorrect, tally.slips),
      pct(tally.isBetSlipCorrect, tally.slips),
      `${pct(fieldCorrect, fieldTotal)} / ${(100 * fieldAccuracy(r.unordered)).toFixed(1)}%`,
      `$${r.costPerImage.toFixed(4)} |`,
    ].join(' | ');
  });
  return [header, sep, ...rows].join('\n');
}
