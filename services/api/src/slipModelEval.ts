/**
 * Multi-model eval harness, not part of the API server (#41). Runs the same bet slip screenshots
 * through several candidate models (`MODEL_CANDIDATES` in `lib/slipImport/modelEval.ts`),
 * scoring each on field accuracy and costing each from real API usage. Calls the Claude API once
 * per image per model, so it costs real money: run it on Parker's Mac with `ANTHROPIC_API_KEY`
 * set, never in CI.
 *
 *   ANTHROPIC_API_KEY=... pnpm --filter @pivot/api exec tsx src/slipModelEval.ts ../../experiments/slip-eval
 *
 * `dir` (default `experiments/slip-eval`) holds screenshots with personal details blurred, each
 * with a hand-written `<name>.expected.json` (see `experiments/slip-eval/README.md`). This never
 * touches `SLIP_READ_MODEL` or `AnthropicSlipReader` — it is read-only eval tooling, separate
 * from the production reader in `reader.ts`.
 */
import Anthropic from '@anthropic-ai/sdk';
import { loadEvalImages } from './lib/slipImport/evalImages.js';
import {
  evalModels,
  formatComparisonTable,
  formatModelEvalResult,
  MODEL_CANDIDATES,
} from './lib/slipImport/modelEval.js';
import { readSlipWithModel } from './lib/slipImport/multiModelReader.js';

async function main(): Promise<void> {
  const key = process.env['ANTHROPIC_API_KEY'];
  if (!key) throw new Error('Set ANTHROPIC_API_KEY to run the slip model eval.');
  const dir = process.argv[2] ?? '../../experiments/slip-eval';
  const { cases, skipped } = await loadEvalImages(dir);
  for (const name of skipped) console.log(`${name}: not an image the reader takes, skipped`);
  if (cases.length === 0) {
    console.log(`No screenshots in ${dir}. See experiments/slip-eval/README.md.`);
    return;
  }
  console.log(`Running ${cases.length} image(s) through ${MODEL_CANDIDATES.length} models...\n`);

  const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 60_000 });
  const results = await evalModels(MODEL_CANDIDATES, cases, (model, image) =>
    readSlipWithModel(client, model, image),
  );

  for (const result of results) {
    console.log(formatModelEvalResult(result));
    console.log('');
  }
  console.log('Comparison (paste into docs/SLIP-MODEL-EVAL.md):\n');
  console.log(formatComparisonTable(results));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
