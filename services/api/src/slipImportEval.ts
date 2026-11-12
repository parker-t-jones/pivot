/**
 * Eval harness, not part of the API server. Measures how well the bet slip reader (#12) reads real
 * screenshots, field by field. It calls the Claude API once per image, so it costs money: run it
 * on Parker's Mac with `ANTHROPIC_API_KEY` set, never in CI.
 *
 *   ANTHROPIC_API_KEY=... pnpm --filter @pivot/api exec tsx src/slipImportEval.ts ../../experiments/slip-eval
 *
 * `dir` (default `experiments/slip-eval`) holds screenshots with personal details blurred, each
 * with a hand-written `<name>.expected.json` (see `experiments/slip-eval/README.md`). Prints
 * accuracy per field. Only the reader is measured; matching to this week's players and games
 * is covered by unit tests.
 */
import { AnthropicSlipReader } from './lib/slipImport/reader.js';
import { emptyTally, formatTally, scoreSlip } from './lib/slipImport/evalScore.js';
import { loadEvalImages } from './lib/slipImport/evalImages.js';

async function main(): Promise<void> {
  const key = process.env['ANTHROPIC_API_KEY'];
  if (!key) throw new Error('Set ANTHROPIC_API_KEY to run the slip import eval.');
  const dir = process.argv[2] ?? '../../experiments/slip-eval';
  const reader = new AnthropicSlipReader(key);
  const tally = emptyTally();
  const { cases, skipped } = await loadEvalImages(dir);
  for (const name of skipped) console.log(`${name}: not an image the reader takes, skipped`);
  if (cases.length === 0) {
    console.log(`No screenshots in ${dir}. See experiments/slip-eval/README.md.`);
    return;
  }
  for (const { name, image, expected } of cases) {
    try {
      const read = await reader.read(image);
      scoreSlip(tally, read, expected);
      console.log(`${name}: ${read.legs.length}/${expected.legs.length} legs read`);
    } catch (error) {
      scoreSlip(tally, { is_bet_slip: false, bet_count: 0, legs: [] }, expected);
      console.log(`${name}: read failed (${error instanceof Error ? error.message : 'unknown'})`);
    }
  }
  console.log(`\n${formatTally(tally)}`);
}

if (process.argv.slice(2).some((arg) => arg.startsWith('--'))) {
  process.argv.push('--production-path');
  void import('./slipModelEval.js');
} else
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
