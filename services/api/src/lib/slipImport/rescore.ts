/** Reads saved model results and ground truth only; never constructs a reader or client. */
import { readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { ExpectedSlip } from './evalScore.js';
import { scoreModelRecords, type ModelEvalResult } from './modelEval.js';
import { slipReadSchema } from './schema.js';

export async function rescoreResults(file: string, dir?: string) {
  const saved = JSON.parse(await readFile(file, 'utf8')) as {
    version: number;
    options: { dir?: string };
    results: ModelEvalResult[];
  };
  if (saved.version !== 1 || !Array.isArray(saved.results))
    throw new Error('Expected version 1 model eval results');
  const slipsDir = dir ?? saved.options.dir;
  if (!slipsDir) throw new Error('Pass the slips directory as the first argument.');
  const expected = new Map<string, ExpectedSlip>();
  for (const result of saved.results) {
    if (!Array.isArray(result.records)) throw new Error('Results must contain saved read records');
    for (const record of result.records) {
      slipReadSchema.parse(record.read);
      if (basename(record.name) !== record.name)
        throw new Error('Record name must be an image filename');
      if (expected.has(record.name)) continue;
      const base = record.name.slice(0, -extname(record.name).length);
      const want = JSON.parse(
        await readFile(join(slipsDir, `${base}.expected.json`), 'utf8'),
      ) as ExpectedSlip & { verification?: string };
      if (want.verification)
        throw new Error(`${base}: unverified expected data is not ground truth`);
      expected.set(record.name, want);
    }
  }
  return {
    ...saved,
    options: { ...saved.options, dir: slipsDir },
    results: saved.results.map((result) => scoreModelRecords(result, result.records, expected)),
  };
}
