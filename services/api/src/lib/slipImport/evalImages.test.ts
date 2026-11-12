import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEvalImages } from './evalImages.js';

// A real PNG signature plus a few more bytes — small enough to fake, but real enough that
// `sniffImageType` reads it as `image/png`, same as a real (blurred) slip screenshot would be.
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('loadEvalImages', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'slip-eval-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('pairs each image with its hand-written expected.json, in name order', async () => {
    await writeFile(join(dir, 'b_parlay.png'), PNG_HEADER);
    await writeFile(
      join(dir, 'b_parlay.expected.json'),
      JSON.stringify({ bet_count: 2, legs: [] }),
    );
    await writeFile(join(dir, 'a_single.png'), PNG_HEADER);
    await writeFile(
      join(dir, 'a_single.expected.json'),
      JSON.stringify({ bet_count: 1, legs: [], is_bet_slip: false }),
    );
    // A non-image file that should be ignored entirely, expected.json and all.
    await writeFile(join(dir, 'notes.txt'), 'blur before committing');

    const { cases, skipped } = await loadEvalImages(dir);

    expect(cases.map((c) => c.name)).toEqual(['a_single.png', 'b_parlay.png']);
    expect(cases[0]?.expected).toEqual({ bet_count: 1, legs: [], is_bet_slip: false });
    expect(cases[0]?.image.mediaType).toBe('image/png');
    expect(cases[0]?.image.data).toBe(PNG_HEADER.toString('base64'));
    expect(skipped).toEqual([]);
  });

  it('skips a file with an image extension but bytes that do not sniff as one', async () => {
    await writeFile(join(dir, 'fake.png'), Buffer.from('not actually a png'));

    const { cases, skipped } = await loadEvalImages(dir);

    expect(cases).toEqual([]);
    expect(skipped).toEqual(['fake.png']);
  });
  it('never treats a draft as ground truth and rejects renamed unverified data', async () => {
    await writeFile(join(dir, 'a.png'), PNG_HEADER);
    await writeFile(
      join(dir, 'a.expected.draft.json'),
      JSON.stringify({ verification: 'UNVERIFIED', bet_count: 0, legs: [] }),
    );
    await expect(loadEvalImages(dir)).rejects.toThrow();
    const loaded = await loadEvalImages(dir, { allowMissingExpected: true });
    expect(loaded.cases[0]?.unverified).toBe(true);
    await writeFile(
      join(dir, 'a.expected.json'),
      JSON.stringify({ verification: 'UNVERIFIED', bet_count: 0, legs: [] }),
    );
    await expect(loadEvalImages(dir, { allowMissingExpected: true })).rejects.toThrow('unverified');
  });
});
