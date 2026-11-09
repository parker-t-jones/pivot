/**
 * THROWAWAY harness — experiments only. Measures how well the bet slip reader (#12) reads real
 * screenshots, field by field. It calls the Claude API once per image, so it costs money: run it
 * on Parker's Mac with `ANTHROPIC_API_KEY` set, never in CI.
 *
 *   ANTHROPIC_API_KEY=... pnpm exec tsx experiments/slip-import-eval.ts [dir]
 *
 * `dir` (default `experiments/slip-eval`) holds screenshots with personal details blurred, each
 * with a hand-written `<name>.expected.json` (see `experiments/slip-eval/README.md`). Prints
 * accuracy per field. Only the reader is measured; matching to this week's players and games
 * is covered by unit tests.
 */
import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { AnthropicSlipReader, sniffImageType } from '../services/api/src/lib/slipImport/reader.js';
import { emptyTally, formatTally, scoreSlip, type ExpectedSlip } from './slipEvalScore';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

async function main(): Promise<void> {
  const key = process.env['ANTHROPIC_API_KEY'];
  if (!key) throw new Error('Set ANTHROPIC_API_KEY to run the slip import eval.');
  const dir = process.argv[2] ?? 'experiments/slip-eval';
  const reader = new AnthropicSlipReader(key);
  const tally = emptyTally();
  const names = (await readdir(dir)).filter((name) =>
    IMAGE_EXTENSIONS.has(extname(name).toLowerCase()),
  );
  if (names.length === 0) {
    console.log(`No screenshots in ${dir}. See experiments/slip-eval/README.md.`);
    return;
  }
  for (const name of names.sort()) {
    const base = name.slice(0, -extname(name).length);
    const bytes = await readFile(join(dir, name));
    const mediaType = sniffImageType(bytes);
    if (mediaType === null) {
      console.log(`${name}: not an image the reader takes, skipped`);
      continue;
    }
    const expected = JSON.parse(
      await readFile(join(dir, `${base}.expected.json`), 'utf8'),
    ) as ExpectedSlip;
    try {
      const read = await reader.read({ mediaType, data: bytes.toString('base64') });
      scoreSlip(tally, read, expected);
      console.log(`${name}: ${read.legs.length}/${expected.legs.length} legs read`);
    } catch (error) {
      scoreSlip(tally, { is_bet_slip: false, bet_count: 0, legs: [] }, expected);
      console.log(`${name}: read failed (${error instanceof Error ? error.message : 'unknown'})`);
    }
  }
  console.log(`\n${formatTally(tally)}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
