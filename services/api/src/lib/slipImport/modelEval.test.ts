import { describe, expect, it } from 'vitest';
import {
  evalModel,
  evalModels,
  formatComparisonTable,
  formatModelEvalResult,
  type ImageCase,
  type ModelReader,
} from './modelEval.js';
import { SlipReadError } from './reader.js';
import { leg } from './fixtures.test-helper.js';

const IMAGE = { mediaType: 'image/png' as const, data: 'aaaa' };

const SLIP_CASE: ImageCase = {
  name: 'slip1.png',
  image: IMAGE,
  expected: { bet_count: 1, legs: [{ ...leg(), line: 60.5 }] },
};
const NOT_A_SLIP_CASE: ImageCase = {
  name: 'notaslip.png',
  image: IMAGE,
  expected: { bet_count: 0, legs: [], is_bet_slip: false },
};

describe('evalModel', () => {
  it('scores a correct read, costs it from usage, and reports no failures', async () => {
    const read: ModelReader = async () => ({
      read: { is_bet_slip: true, bet_count: 1, legs: [{ ...leg(), line: 60.5 }] },
      usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
    });
    const result = await evalModel(
      { model: 'claude-opus-5-5', label: 'Opus 5.5' },
      [SLIP_CASE],
      read,
    );

    expect(result.tally.fields.line).toEqual({ correct: 1, total: 1 });
    expect(result.totalCost).toBeCloseTo(4 + 20, 6);
    expect(result.costPerImage).toBeCloseTo(24, 6);
    expect(result.failures).toEqual([]);
  });

  it('scores a read failure as a dropped, non-slip read and records it as a failure', async () => {
    const read: ModelReader = async () => {
      throw new SlipReadError('unparseable');
    };
    const result = await evalModel(
      { model: 'claude-haiku-5-5', label: 'Haiku 5.5' },
      [SLIP_CASE],
      read,
    );

    expect(result.tally.fields.line).toEqual({ correct: 0, total: 1 });
    expect(result.totalCost).toBe(0);
    expect(result.failures).toEqual([
      { name: 'slip1.png', message: 'slip read failed: unparseable' },
    ]);
  });

  it('scores correct and wrong is_bet_slip detection', async () => {
    let call = 0;
    const read: ModelReader = async () => {
      call += 1;
      // First call (the real slip) reads correctly; wrongly flags the second (non-slip) as a slip.
      return call === 1
        ? {
            read: { is_bet_slip: true, bet_count: 1, legs: [{ ...leg(), line: 60.5 }] },
            usage: { input_tokens: 0, output_tokens: 0 },
          }
        : {
            read: { is_bet_slip: true, bet_count: 0, legs: [] },
            usage: { input_tokens: 0, output_tokens: 0 },
          };
    };
    const result = await evalModel(
      { model: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
      [SLIP_CASE, NOT_A_SLIP_CASE],
      read,
    );

    expect(result.tally.isBetSlipCorrect).toBe(1);
    expect(result.tally.slips).toBe(2);
  });

  it('costPerImage is 0, not NaN, for an empty case list', async () => {
    const result = await evalModel(
      { model: 'claude-opus-5-5', label: 'Opus 5.5' },
      [],
      async () => {
        throw new Error('should not be called');
      },
    );
    expect(result.costPerImage).toBe(0);
  });
});

describe('evalModels', () => {
  it('runs every candidate over the same cases', async () => {
    const read: ModelReader = async (model) => ({
      read: { is_bet_slip: true, bet_count: 1, legs: [{ ...leg(), line: 60.5 }] },
      usage: { input_tokens: model.length, output_tokens: 1 },
    });
    const results = await evalModels(
      [
        { model: 'claude-opus-5-5', label: 'Opus 5.5' },
        { model: 'claude-haiku-5-5', label: 'Haiku 5.5' },
      ],
      [SLIP_CASE],
      read,
    );
    expect(results.map((r) => r.model)).toEqual(['claude-opus-5-5', 'claude-haiku-5-5']);
  });
});

describe('formatting', () => {
  it('formatModelEvalResult includes the label, accuracy, and cost', async () => {
    const read: ModelReader = async () => ({
      read: { is_bet_slip: true, bet_count: 1, legs: [{ ...leg(), line: 60.5 }] },
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const result = await evalModel(
      { model: 'claude-opus-5-5', label: 'Opus 5.5' },
      [SLIP_CASE],
      read,
    );
    const text = formatModelEvalResult(result);
    expect(text).toContain('Opus 5.5');
    expect(text).toContain('claude-opus-5-5');
    expect(text).toContain('cost: $0.0000 total, $0.0000/image');
  });

  it('formatComparisonTable renders one row per model as a markdown table', async () => {
    const read: ModelReader = async () => ({
      read: { is_bet_slip: true, bet_count: 1, legs: [{ ...leg(), line: 60.5 }] },
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const results = await evalModels(
      [
        { model: 'claude-opus-5-5', label: 'Opus 5.5' },
        { model: 'claude-haiku-5-5', label: 'Haiku 5.5' },
      ],
      [SLIP_CASE],
      read,
    );
    const table = formatComparisonTable(results);
    const lines = table.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[2]).toContain('Opus 5.5');
    expect(lines[3]).toContain('Haiku 5.5');
  });
});

it('repeats reads and reports per-run ranges and individual failures', async () => {
  let call = 0;
  const result = await evalModel(
    { model: 'custom', label: 'custom' },
    [SLIP_CASE],
    async () => {
      if (++call === 2) throw new Error('offline');
      return {
        read: { is_bet_slip: true, bet_count: 1, legs: [leg({ line: 60.5 })] },
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      };
    },
    { runs: 2, prices: { custom: { inputPerMillion: 2, outputPerMillion: 4 } } },
  );
  expect(call).toBe(2);
  expect(result.runStats.cost).toEqual({ mean: 1, min: 0, max: 2 });
  expect(result.runStats.fieldAccuracy).toEqual({ mean: 0.5, min: 0, max: 1 });
  expect(result.records[0]).toMatchObject({ run: 1, cost: 2, failure: null, wrong: [] });
  expect(result.records[1]).toMatchObject({ run: 2, cost: null, usage: null, failure: 'offline' });
  expect(result.records[1]?.wrong).toHaveLength(8);
});
it('rejects unknown pricing before invoking even a known model', async () => {
  let called = false;
  await expect(
    evalModels(
      [
        { model: 'claude-opus-5-5', label: 'known' },
        { model: 'unknown', label: 'unknown' },
      ],
      [SLIP_CASE],
      async () => {
        called = true;
        throw new Error('unexpected');
      },
    ),
  ).rejects.toThrow('no pricing for model unknown');
  expect(called).toBe(false);
});

it('aggregates import counts and per-run ranges independently from raw field accuracy', async () => {
  let call = 0;
  const result = await evalModel(
    { model: 'claude-haiku-5-5', label: 'Haiku' },
    [SLIP_CASE],
    async () => ({
      read: { is_bet_slip: true, bet_count: ++call === 2 ? 6 : 1, legs: [leg({ line: 60.5 })] },
      usage: null,
    }),
    { runs: 3 },
  );
  expect(result.importOutcome).toMatchObject({
    flagged: 2,
    rejected_multiple_bets: 1,
    silent_wrong: 0,
  });
  expect(result.importRunStats.rejected_multiple_bets).toEqual({ mean: 1 / 3, min: 0, max: 1 });
  expect(result.records.map((r) => r.importOutcome?.slips)).toEqual([
    [],
    ['rejected_multiple_bets'],
    [],
  ]);
  expect(formatComparisonTable([result])).toContain('| 0 | 1 | 0 / 0 |');
});
