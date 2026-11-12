import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { leg } from './fixtures.test-helper.js';
import { evalModel, formatModelEvalResult } from './modelEval.js';
import { formatTally } from './evalScore.js';
import { rescoreResults } from './rescore.js';

const blockedClient = vi.hoisted(() =>
  vi.fn(function () {
    throw new Error('No client allowed');
  }),
);
vi.mock('@anthropic-ai/sdk', () => ({ default: blockedClient }));
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'slip-rescore-'));
  dirs.push(dir);
  const td = leg({ market: 'ANYTIME_TD', player: 'Saquon Barkley', team: 'PHI', side: 'YES' });
  const expected = { bet_count: 1, legs: [td] };
  const result = await evalModel(
    { model: 'claude-haiku-5-5', label: 'Haiku' },
    [{ name: 'slip.png', expected, image: { mediaType: 'image/png', data: '' } }],
    async () => ({
      read: {
        is_bet_slip: true,
        bet_count: 1,
        legs: [{ ...td, side: null, team: null }],
      },
      usage: { input_tokens: 100, output_tokens: 20 },
    }),
    { runs: 2 },
  );
  await writeFile(join(dir, 'slip.expected.json'), JSON.stringify(expected));
  // Model the original version-1 schema, before import outcomes existed.
  const { importOutcome: _outcome, importRunStats: _stats, ...old } = result;
  const saved = {
    version: 1,
    options: { dir },
    results: [
      { ...old, records: old.records.map(({ importOutcome: _legOutcome, ...record }) => record) },
    ],
  };
  const file = join(dir, 'results.json');
  await writeFile(file, JSON.stringify(saved));
  return { dir, file, result };
}

it('rescores old records without images and preserves raw output and billing metadata', async () => {
  const { file, result } = await fixture();
  const before = await readFile(file, 'utf8');
  const rescored = (await rescoreResults(file)).results[0];
  if (!rescored) throw new Error('Expected a model result');
  expect(formatTally(rescored.tally)).toBe(formatTally(result.tally));
  expect(rescored.tally).toEqual(result.tally);
  expect(rescored.unordered).toEqual(result.unordered);
  expect(rescored.runStats).toEqual(result.runStats);
  expect(rescored.records).toEqual(result.records);
  expect(rescored.totalCost).toBe(result.totalCost);
  expect(rescored.importOutcome).toMatchObject({
    match: 2,
    silent_wrong: 0,
    team_differs_blank: 2,
  });
  expect(rescored.importRunStats.team_differs_blank).toEqual({ mean: 1, min: 1, max: 1 });
  expect(formatModelEvalResult(rescored)).toContain(
    `Positional:\n${formatTally(result.tally)}\nOrder-insensitive (best assignment):\n${formatTally(result.unordered)}`,
  );
  expect(await readFile(file, 'utf8')).toBe(before);
});
it('runs the actual --rescore CLI with no key, client construction or network calls', async () => {
  const { file, dir } = await fixture();
  const out = join(dir, 'rescored.json');
  vi.stubEnv('ANTHROPIC_API_KEY', undefined);
  const network = vi.fn(() => {
    throw new Error('No network allowed');
  });
  vi.stubGlobal('fetch', network);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const argv = process.argv;
  const exitCode = process.exitCode;
  process.argv = ['node', 'slipModelEval.ts', '--rescore', file, '--out', out];
  try {
    await import('../../slipModelEval.js');
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith(expect.stringContaining('| model |')));
    expect(error).not.toHaveBeenCalled();
    expect(blockedClient).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(out, 'utf8')).results[0].importOutcome.match).toBe(2);
  } finally {
    process.argv = argv;
    process.exitCode = exitCode;
  }
});
it('requires reviewed expected files and accepts an explicit directory override', async () => {
  const { file, dir } = await fixture();
  const saved = JSON.parse(await readFile(file, 'utf8'));
  saved.options.dir = '/missing-original-slips';
  await writeFile(file, JSON.stringify(saved));
  const rescored = await rescoreResults(file, dir);
  expect(rescored.results).toHaveLength(1);
  expect(rescored.options.dir).toBe(dir);
  await writeFile(join(dir, 'slip.expected.json'), JSON.stringify({ verification: 'UNVERIFIED' }));
  await expect(rescoreResults(file, dir)).rejects.toThrow('unverified expected');
});
