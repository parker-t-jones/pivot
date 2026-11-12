# Slip reader model eval (#41)

**Status: not yet run.** No real sportsbook slip screenshots were available in this sandbox, so
the harness below is built and unit-tested, but has never made a real Claude API call. This file
is a stub for Parker to fill in once he runs it on his Mac with real images and a real key.

## Why

`AnthropicSlipReader` (`services/api/src/lib/slipImport/reader.ts`) hardcodes
`SLIP_READ_MODEL = 'claude-opus-5-5'`, chosen without measurement when the slip import feature
(#12) shipped. The current table estimates Opus at $4/M input tokens and $20/M output tokens; these rates are unverified.
Reading one bet slip screenshot into structured JSON is closer to constrained extraction than
open-ended reasoning, so a cheaper model may do just as well for a fraction of the cost — but
that's a guess until it's measured against real slips.

## How to run it

See [the eval README](../experiments/slip-eval/README.md) for ground-truth format and all flags.
Keep a private, reviewed 10–20 image set outside the repository; include multiple books,
markets, singles/parlays, and a non-slip. Set `ANTHROPIC_API_KEY` locally without logging it.
From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @pivot/api exec tsx src/slipModelEval.ts /absolute/path/to/slips --runs 3 --as-app=ios --out
pnpm --filter @pivot/api exec tsx src/slipModelEval.ts /absolute/path/to/slips --runs 3 --as-app=web --out /absolute/path/to/web-results.json
pnpm --filter @pivot/api exec tsx src/slipModelEval.ts /absolute/path/to/slips --production-path --as-app=ios --out /absolute/path/to/production-smoke.json
```

Expect positional and best-assignment scores, per-run mean/min/max accuracy and cost, and
JSON records for every image/model/run. `--models` and repeated `--price id=in:out` support
explicit candidates and rates; unknown rates stop the run before API calls. `--draft-expected`
creates UNVERIFIED drafts, never ground truth. Do not score unreviewed model output as truth.
The default output and screenshots in `experiments/slip-eval` are gitignored.

Native profile: JPEG quality 70 without resizing (`slipImage.ts` quality 0.7). Web profile:
JPEG quality 85 and long edge capped at 2000px (`slipImage.web.ts`). Sharp loads only on the
optional eval path; different platform encoders may produce different bytes.

Team scoring resolves both values through production `resolveTeam` against a static 32-team
fixture. Unknown or ambiguous strings are wrong; absent team fields match when both are null.
Best assignment matches legs one-to-one to maximize correct fields; read failures remain in
accuracy denominators. Inspect count checks too: field accuracy alone does not penalize extra legs.

JSON failures have null cost/tokens when usage is unavailable; totals sum known usage only.
Production-path uses `AnthropicSlipReader` unchanged and observes its SDK usage; fallback billing
may differ from the pinned model estimate. Live API behavior, real-slip accuracy, provider rates
and Docker builds have not been verified here. No recommendation is justified yet.

## Models compared

| Model      | ID                  | Input $/M | Output $/M |
| ---------- | ------------------- | --------- | ---------- |
| Opus 5.5   | `claude-opus-5-5`   | $4.00     | $20.00     |
| Sonnet 5.5 | `claude-sonnet-5-5` | $2.00     | $10.00     |
| Haiku 5.5  | `claude-haiku-5-5`  | $0.10     | $0.50      |

Pricing from `services/api/src/lib/slipImport/modelCost.ts` — re-check against current Anthropic
pricing before trusting an old run of this table; these rates can change.

The default comparison runs all three at the same prompt, JSON schema, and `effort: 'medium'` as the production reader,
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
