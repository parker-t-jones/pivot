import { describe, expect, it } from 'vitest';
import { costForUsage, MODEL_PRICING } from './modelCost.js';

describe('costForUsage', () => {
  it('prices Opus 5.5 input and output at their listed per-million rates', () => {
    const cost = costForUsage('claude-opus-5-5', {
      input_tokens: 1_000_000,
      output_tokens: 500_000,
    });
    expect(cost).toBeCloseTo(4 + 10, 6);
  });

  it('prices Haiku 5.5 far cheaper than Opus 5.5 for the same usage', () => {
    const usage = { input_tokens: 2_000, output_tokens: 300 };
    const haiku = costForUsage('claude-haiku-5-5', usage);
    const opus = costForUsage('claude-opus-5-5', usage);
    expect(haiku).toBeLessThan(opus);
    expect(haiku).toBeGreaterThan(0);
  });

  it('throws for a model with no listed rate rather than costing it as free', () => {
    expect(() =>
      costForUsage('claude-unknown-model', { input_tokens: 1, output_tokens: 1 }),
    ).toThrow(/no pricing/);
  });

  it('lists exactly the three eval candidates', () => {
    expect(Object.keys(MODEL_PRICING).sort()).toEqual(
      ['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5'].sort(),
    );
  });
});

it('supports explicit rates and rejects inherited property names', () => {
  expect(
    costForUsage(
      'custom',
      { input_tokens: 1_000_000, output_tokens: 500_000 },
      { custom: { inputPerMillion: 3, outputPerMillion: 6 } },
    ),
  ).toBe(6);
  expect(() => costForUsage('toString', { input_tokens: 1, output_tokens: 1 })).toThrow(
    'no pricing',
  );
});
