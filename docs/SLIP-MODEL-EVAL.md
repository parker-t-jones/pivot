# Slip reader model eval (#41)

**Status: not yet run.** No real sportsbook slip screenshots were available in this sandbox, so
the harness below is built and unit-tested, but has never made a real Claude API call. This file
is a stub for Parker to fill in once he runs it on his Mac with real images and a real key.

## Why

`AnthropicSlipReader` (`services/api/src/lib/slipImport/reader.ts`) hardcodes
`SLIP_READ_MODEL = 'claude-opus-5-5'`, chosen without measurement when the slip import feature
(#12) shipped. Opus 5.5 is Anthropic's priciest model ($4/M input tokens, $20/M output tokens).
Reading one bet slip screenshot into structured JSON is closer to constrained extraction than
open-ended reasoning, so a cheaper model may do just as well for a fraction of the cost — but
that's a guess until it's measured against real slips.

## How to run it

1. Collect 10-20 real sportsbook slip screenshots (a mix of DraftKings, FanDuel, and at least one
   other book; singles and parlays; player props, spreads, totals; a quarter/half line; and at
   least one non-slip image). **Blur or crop out balances, usernames, bet IDs, stakes, payouts,
   and promotions before saving.**
2. Drop each `<name>.png` (or `.jpg`) into `experiments/slip-eval/`, with a hand-written
   `<name>.expected.json` next to it (see `experiments/slip-eval/README.md` for the shape).
3. Run the comparison (one Claude API call per image per model — real money, three models):

   ```bash
   ANTHROPIC_API_KEY=... pnpm --filter @pivot/api exec tsx src/slipModelEval.ts ../../experiments/slip-eval
   ```

4. Paste the printed comparison table below, and fill in the per-model sections and the
   recommendation.

## Models compared

| Model      | ID                  | Input $/M | Output $/M |
| ---------- | ------------------- | --------- | ---------- |
| Opus 5.5   | `claude-opus-5-5`   | $4.00     | $20.00     |
| Sonnet 5.5 | `claude-sonnet-5-5` | $2.00     | $10.00     |
| Haiku 5.5  | `claude-haiku-5-5`  | $0.10     | $0.50      |

Pricing from `services/api/src/lib/slipImport/modelCost.ts` — re-check against current Anthropic
pricing before trusting an old run of this table; these rates can change.

All three run at the same prompt, JSON schema, and `effort: 'medium'` as the production reader,
so the comparison measures model choice only (see `multiModelReader.ts`). The eval run skips the
server-side refusal fallback the production path uses — a cost measurement wants to know what
each model alone costs and gets right, not what a fallback masks.

## Results

_(not run — paste the harness's comparison table here)_

| model                            | leg count | bet count | is_bet_slip | field accuracy (avg) | $/image |
| -------------------------------- | --------- | --------- | ----------- | -------------------- | ------- |
| Opus 5.5 (`claude-opus-5-5`)     | —         | —         | —           | —                    | —       |
| Sonnet 5.5 (`claude-sonnet-5-5`) | —         | —         | —           | —                    | —       |
| Haiku 5.5 (`claude-haiku-5-5`)   | —         | —         | —           | —                    | —       |

### Opus 5.5

_(not run)_

### Sonnet 5.5

_(not run)_

### Haiku 5.5

_(not run)_

## Recommendation

_(not run — no accuracy or cost numbers exist yet, so no recommendation can be made)_

If a cheaper model's accuracy is close enough to Opus 5.5's, say so explicitly here and note it as
a candidate follow-up to change `SLIP_READ_MODEL` — **do not change the production model as part
of filling in this doc**. A worse misread becomes a user-facing wrong pick, so swapping the
production model is a separate decision for Parker once he's seen the real numbers.
