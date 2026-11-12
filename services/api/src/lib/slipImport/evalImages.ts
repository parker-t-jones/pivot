/**
 * Loads an eval directory of bet slip screenshots and their hand-written expected JSON (#12, #41).
 * Shared by the single-model and multi-model eval runners.
 */
import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { sniffImageType, type SlipImage } from './reader.js';
import type { ExpectedSlip } from './evalScore.js';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export interface EvalImageCase {
  name: string;
  image: SlipImage;
  expected: ExpectedSlip;
  unverified?: boolean;
}

export interface LoadedEvalImages {
  cases: EvalImageCase[];
  /** File names present but not a recognized image type (sniffed from bytes, not extension). */
  skipped: string[];
}

export async function loadEvalImages(
  dir: string,
  options: { allowMissingExpected?: boolean } = {},
): Promise<LoadedEvalImages> {
  const names = (await readdir(dir)).filter((name) =>
    IMAGE_EXTENSIONS.has(extname(name).toLowerCase()),
  );
  const cases: EvalImageCase[] = [];
  const skipped: string[] = [];
  for (const name of names.sort()) {
    const base = name.slice(0, -extname(name).length);
    const bytes = await readFile(join(dir, name));
    const mediaType = sniffImageType(bytes);
    if (mediaType === null) {
      skipped.push(name);
      continue;
    }
    let expected: ExpectedSlip;
    let unverified = false;
    try {
      const parsed = JSON.parse(
        await readFile(join(dir, `${base}.expected.json`), 'utf8'),
      ) as ExpectedSlip & { verification?: string };
      if (parsed.verification)
        throw new Error(`${base}: unverified expected data is not ground truth`);
      expected = parsed;
    } catch (error) {
      if (
        !options.allowMissingExpected ||
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      )
        throw error;
      expected = { bet_count: 0, legs: [], is_bet_slip: false };
      unverified = true;
    }
    cases.push({
      name,
      image: { mediaType, data: bytes.toString('base64') },
      expected,
      unverified,
    });
  }
  return { cases, skipped };
}
