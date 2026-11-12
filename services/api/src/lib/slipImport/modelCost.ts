/**
 * Per-model $ cost from real API usage, for the slip-reader model eval (#41). Pricing is
 * first-party Claude API rates as of 2026-11; re-check before trusting an old number.
 */

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface ModelPricing {
  /** $ per million input tokens. */
  inputPerMillion: number;
  /** $ per million output tokens. */
  outputPerMillion: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-5-5': { inputPerMillion: 4, outputPerMillion: 20 },
  'claude-sonnet-5-5': { inputPerMillion: 2, outputPerMillion: 10 },
  'claude-haiku-5-5': { inputPerMillion: 0.1, outputPerMillion: 0.5 },
};

/** Throws for a model this table has no rate for, rather than silently costing it as free. */
export function costForUsage(model: string, usage: TokenUsage, prices = MODEL_PRICING): number {
  const pricing = prices[model];
  if (!Object.hasOwn(prices, model) || !pricing) throw new Error(`no pricing for model ${model}`);
  return (
    (usage.input_tokens / 1_000_000) * pricing.inputPerMillion +
    (usage.output_tokens / 1_000_000) * pricing.outputPerMillion
  );
}
