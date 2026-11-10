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
  type EvalTally,
  type ExpectedSlip,
} from './evalScore.js';
import { costForUsage, type TokenUsage } from './modelCost.js';
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
}

export interface ReadFailure {
  name: string;
  message: string;
}

export type ModelReader = (
  model: string,
  image: SlipImage,
) => Promise<{ read: SlipRead; usage: TokenUsage }>;

export interface ModelEvalResult {
  model: string;
  label: string;
  tally: EvalTally;
  totalCost: number;
  costPerImage: number;
  failures: ReadFailure[];
}

/** A read that fails (upstream error, refusal, unparseable answer) scores as a non-slip with no
 *  legs, same as the single-model runner — a dropped read should look just as wrong as a dropped
 *  leg, not vanish from the tally. */
export async function evalModel(
  candidate: ModelCandidate,
  cases: ImageCase[],
  read: ModelReader,
): Promise<ModelEvalResult> {
  const tally = emptyTally();
  const failures: ReadFailure[] = [];
  let totalCost = 0;
  for (const { name, image, expected } of cases) {
    try {
      const { read: got, usage } = await read(candidate.model, image);
      totalCost += costForUsage(candidate.model, usage);
      scoreSlip(tally, got, expected);
    } catch (error) {
      failures.push({ name, message: error instanceof Error ? error.message : String(error) });
      scoreSlip(tally, { is_bet_slip: false, bet_count: 0, legs: [] }, expected);
    }
  }
  return {
    model: candidate.model,
    label: candidate.label,
    tally,
    totalCost,
    costPerImage: cases.length === 0 ? 0 : totalCost / cases.length,
    failures,
  };
}

export async function evalModels(
  candidates: ModelCandidate[],
  cases: ImageCase[],
  read: ModelReader,
): Promise<ModelEvalResult[]> {
  const results: ModelEvalResult[] = [];
  for (const candidate of candidates) {
    results.push(await evalModel(candidate, cases, read));
  }
  return results;
}

export function formatModelEvalResult(result: ModelEvalResult): string {
  const lines = [
    `## ${result.label} (\`${result.model}\`)`,
    '',
    formatTally(result.tally),
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
  const header = '| model | leg count | bet count | is_bet_slip | field accuracy (avg) | $/image |';
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
      pct(fieldCorrect, fieldTotal),
      `$${r.costPerImage.toFixed(4)} |`,
    ].join(' | ');
  });
  return [header, sep, ...rows].join('\n');
}
