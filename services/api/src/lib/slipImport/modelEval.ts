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
import {
  addImportOutcome,
  emptyImportTally,
  scoreImportOutcome,
  type ImportOutcome,
  type ImportTally,
} from './importOutcome.js';

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

export interface ModelCallUsage {
  model: string;
  /** Null when a call throws before the SDK returns usage. */
  usage: TokenUsage | null;
}

export type ModelReader = (
  model: string,
  image: SlipImage,
) => Promise<{ read: SlipRead; usage: TokenUsage | null; calls?: ModelCallUsage[] }>;

export interface ModelEvalResult {
  model: string;
  label: string;
  tally: EvalTally;
  totalCost: number;
  costPerImage: number;
  failures: ReadFailure[];
  unordered: EvalTally;
  records: EvalRecord[];
  importOutcome: ImportTally;
  importRunStats: Record<keyof ImportTally, Stats>;
  runStats: { fieldAccuracy: Stats; unorderedAccuracy: Stats; cost: Stats };
}

export interface EvalRecord {
  name: string;
  model: string;
  run: number;
  latencyMs: number;
  usage: TokenUsage | null;
  calls?: ModelCallUsage[];
  cost: number | null;
  failure: string | null;
  wrong: ReturnType<typeof wrongFields>;
  scored: boolean;
  slipWrong: { field: string; expected: number | boolean; got: number | boolean }[];
  counts: { expected: number; got: number };
  read: SlipRead;
  importOutcome: ImportOutcome | null;
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
  const records: EvalRecord[] = [];
  for (let run = 1; run <= runs; run++) {
    for (const { name, image, expected, unverified } of cases) {
      const start = performance.now();
      let got: SlipRead = { is_bet_slip: false, bet_count: 0, legs: [] };
      let usage: TokenUsage | null = null,
        cost: number | null = null,
        failure: string | null = null;
      let calls: ModelCallUsage[] | undefined;
      try {
        const result = await read(candidate.model, image);
        got = result.read;
        usage = result.usage;
        calls = result.calls;
        cost = calls
          ? calls.some((call) => call.usage !== null)
            ? calls.reduce(
                (sum, call) =>
                  sum + (call.usage ? costForUsage(call.model, call.usage, prices) : 0),
                0,
              )
            : null
          : usage === null
            ? null
            : costForUsage(candidate.model, usage, prices);
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
      records.push({
        name,
        model: candidate.model,
        run,
        latencyMs: performance.now() - start,
        usage,
        ...(calls ? { calls } : {}),
        cost,
        failure,
        wrong: [],
        scored: !unverified,
        slipWrong: [],
        counts: { expected: expected.legs.length, got: got.legs.length },
        read: got,
        importOutcome: null,
      });
    }
  }
  return scoreModelRecords(
    candidate,
    records,
    new Map(cases.filter((c) => !c.unverified).map((c) => [c.name, c.expected])),
  );
}

/** Shared by fresh reads and offline rescoring; usage, cost, failures and latency are preserved. */
export function scoreModelRecords(
  candidate: ModelCandidate,
  saved: EvalRecord[],
  expected: ReadonlyMap<string, ExpectedSlip>,
): ModelEvalResult {
  const tally = emptyTally(),
    unordered = emptyTally(),
    importOutcome = emptyImportTally();
  const perRun = new Map<
    number,
    { tally: EvalTally; unordered: EvalTally; outcome: ImportTally; cost: number }
  >();
  const records = saved.map((record) => {
    let run = perRun.get(record.run);
    if (!run) {
      run = { tally: emptyTally(), unordered: emptyTally(), outcome: emptyImportTally(), cost: 0 };
      perRun.set(record.run, run);
    }
    run.cost += record.cost ?? 0;
    const want = expected.get(record.name);
    if (!want) return { ...record, scored: false, wrong: [], slipWrong: [], importOutcome: null };
    const got = record.read;
    scoreSlip(tally, got, want);
    scoreSlip(run.tally, got, want);
    scoreUnordered(unordered, got, want);
    scoreUnordered(run.unordered, got, want);
    const outcome = scoreImportOutcome(got, want);
    addImportOutcome(importOutcome, outcome);
    addImportOutcome(run.outcome, outcome);
    return {
      ...record,
      scored: true,
      wrong: wrongFields(got, want),
      importOutcome: outcome,
      slipWrong: [
        { field: 'leg_count', expected: want.legs.length, got: got.legs.length },
        { field: 'bet_count', expected: want.bet_count, got: got.bet_count },
        { field: 'is_bet_slip', expected: want.is_bet_slip ?? true, got: got.is_bet_slip },
      ].filter((f) => f.expected !== f.got),
      counts: { expected: want.legs.length, got: got.legs.length },
    };
  });
  const runs = [...perRun.values()];
  const totalCost = runs.reduce((sum, run) => sum + run.cost, 0);
  const importRunStats = Object.fromEntries(
    Object.keys(importOutcome).map((key) => [
      key,
      stats(runs.map((run) => run.outcome[key as keyof ImportTally])),
    ]),
  ) as Record<keyof ImportTally, Stats>;
  return {
    ...candidate,
    tally,
    unordered,
    importOutcome,
    importRunStats,
    records,
    totalCost,
    costPerImage: records.length ? totalCost / records.length : 0,
    failures: records.flatMap((r) =>
      r.failure === null ? [] : [{ name: r.name, message: r.failure }],
    ),
    runStats: {
      fieldAccuracy: stats(runs.map((r) => fieldAccuracy(r.tally))),
      unorderedAccuracy: stats(runs.map((r) => fieldAccuracy(r.unordered))),
      cost: stats(runs.map((r) => r.cost)),
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
    'Import outcome (condition/team projection):',
    ...Object.entries(result.importOutcome).map(([key, count]) => `${key}: ${count}`),
    ...Object.entries(result.importRunStats).map(
      ([key, s]) =>
        `${key} per-run mean/min/max: ${s.mean.toFixed(6)} / ${s.min.toFixed(6)} / ${s.max.toFixed(6)}`,
    ),
    ...(result.records.some((r) => r.cost === null || r.calls?.some((c) => c.usage === null))
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

/** Confirmation attempts include calls that returned no usage; cost sums known usage only. */
export function summarizeConfirmations(
  records: EvalRecord[],
  model: string,
  prices = MODEL_PRICING,
): { count: number; cost: number; unknownCosts: number } {
  const calls = records
    .flatMap((record) => record.calls ?? [])
    .filter((call) => call.model === model);
  return {
    count: calls.length,
    cost: calls.reduce(
      (sum, call) => sum + (call.usage ? costForUsage(model, call.usage, prices) : 0),
      0,
    ),
    unknownCosts: calls.filter((call) => call.usage === null).length,
  };
}

/** A compact side-by-side table, for pasting into `docs/SLIP-MODEL-EVAL.md`. */
export function formatComparisonTable(results: ModelEvalResult[]): string {
  const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`);
  const header =
    '| model | leg count | bet count | is_bet_slip | field accuracy (positional / best assignment) | silent_wrong | rejected_multiple_bets | team_differs (blank / different) | $/image |';
  const sep = '|---|---|---|---|---|---|---|---|---|';
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
      String(r.importOutcome.silent_wrong),
      String(r.importOutcome.rejected_multiple_bets),
      `${r.importOutcome.team_differs_blank} / ${r.importOutcome.team_differs_different}`,
      `$${r.costPerImage.toFixed(4)} |`,
    ].join(' | ');
  });
  return [header, sep, ...rows].join('\n');
}
