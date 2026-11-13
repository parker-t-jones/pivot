# Slip reader model eval (#41)

**Status:** Issue #126 reports 13 private slips × 10 Haiku 5.5 runs with the current
main prompt and mapper. Launch decision: Haiku 5.5 primary, one Sonnet 5.5 confirmation
only for `is_bet_slip && bet_count > 1`. No Opus reader is configured. The composed
path still needs Parker’s paid acceptance run; Sonnet bet-count reliability is unmeasured.

## Why

Haiku costs much less for constrained extraction, but occasionally counts valid single-bet
parlays as multiple bets. `ConfirmingSlipReader` re-reads those images once with Sonnet and
returns its whole read, including when it still reports multiple bets. A `SlipReadError` from
confirmation preserves the primary read and the route’s existing refusal. Other reads are
returned immediately; there is no confirmation loop. The decorator logs and stores nothing.
The route, prompt, mapper, and quotas are unchanged.

### Anthropic request compatibility

Checked against Anthropic’s documentation for this change:

- [Effort](https://platform.claude.com/docs/en/build-with-claude/effort): Haiku 5.5 supports
  `output_config.effort`, including `medium`. Keep the existing setting on both readers.
- [Refusals and fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback):
  Haiku 5.5 has no server-side fallback. Omit both the `server-side-fallback-2026-07-01`
  beta and `fallbacks: 'default'` for Haiku. Retain them for Sonnet. This provider safety
  fallback is separate from our bet-count confirmation; unreadable/refused Haiku reads
  do not trigger confirmation.

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
pnpm --filter @pivot/api exec tsx src/slipModelEval.ts /absolute/path/to/slips --production-path --runs 10 --as-app=ios --out /absolute/path/to/production-smoke.json
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
Production-path runs the same composed Haiku/Sonnet reader as the server and observes each SDK
call’s usage. It prints the confirmation count and added cost, includes both models’ calls at
their respective rates in per-image cost, and saves per-call model/usage in JSON records.
Unknown confirmation cost is reported explicitly; totals include known usage only.
Sonnet’s provider safety-fallback billing may differ from the requested-model estimate.
Live API behavior, composed real-slip accuracy, and actual billing have not been verified here.

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

## Current-prompt evidence (reported in #126)

13 private slips × 10 runs = 130 Haiku reads:

| Metric                 | Haiku 5.5 primary alone                         |
| ---------------------- | ----------------------------------------------- |
| silent_wrong           | 0                                               |
| flagged                | 20 (two intended OTHER legs on slip 11 per run) |
| match                  | 629                                             |
| field accuracy         | 95.6%                                           |
| cost/image             | approximately $0.0011                           |
| rejected_multiple_bets | 3/130 reads, on valid single-bet parlays        |

Opus 5.5 never misread bet count on these slips, but is too expensive for launch.
Sonnet’s bet-count reliability and the composed path’s outcomes are **not yet measured**.
These numbers are issue evidence, not a run performed by this implementation session.

False accepts on slip 05 (hedge calculator) and slip 08 (odds board): 18/20. They end as
flagged legs rather than wrong picks. Fixing these, and changing the prompt, are out of scope.

## Launch decision and acceptance

Configure `SLIP_READ_MODEL = 'claude-haiku-5-5'` and
`SLIP_CONFIRM_MODEL = 'claude-sonnet-5-5'`. No Opus primary or bet-count confirmation.
Keep the Haiku $0.10/$0.50 and Sonnet $2/$10 per-million-token rates in `modelCost.ts`.

Before enabling production import, Parker runs with his own key and the 13 reviewed private
slips (use the same image profile as the baseline):

```bash
pnpm build
pnpm --filter @pivot/api exec tsx src/slipModelEval.ts /absolute/path/to/slips --production-path --runs 10 --out /absolute/path/to/production-results.json
```

Required: **silent_wrong 0** and **rejected_multiple_bets 0**. Record confirmation count,
added cost, total per-image cost, and the full scorecard. A confirmation that agrees on
multiple bets or fails still permits the unchanged route to refuse; this is why the paid
acceptance run remains necessary. If Sonnet still permits false refusals, Parker can choose
a follow-up to confirm with Opus only on that rare path (issue estimate: ~$0.0007 average)
or move the primary to Sonnet. Neither alternative is implemented here.

No API key is set by this change. Production configuration waits for review, merge, and a
passing acceptance run. Parker handles all Fly commands.
