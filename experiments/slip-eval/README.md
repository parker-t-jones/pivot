# Bet slip import eval (#12, #41)

Keep screenshots private. Blur balances, usernames, bet IDs, stakes, payouts and promotions.
Screenshots and generated JSON under this directory are gitignored. The eval directory can
live outside the repo: pass its absolute path as the **first argument**.

For each `name.png`, `.jpg`, `.jpeg` or `.webp`, hand-review `name.expected.json`:

```json
{
  "bet_count": 1,
  "legs": [
    {
      "market": "PLAYER_STAT",
      "stat": "REC_YDS",
      "player": "A.J. Brown",
      "team": null,
      "side": "OVER",
      "line": 60,
      "plus_style": true,
      "period": "FULL"
    }
  ]
}
```

Use the values in `schema.ts`. Include singles, parlays, multiple books and markets, periods,
and a non-slip with `{ "bet_count": 0, "legs": [], "is_bet_slip": false }`.

For a screenshot with more than one bet, use the grouped format instead, so the scorer can check
how legs are split into bets. Each bet is `single` (one leg) or `parlay` (two or more legs), in
the order shown; `bet_count` is optional and, if given, must equal the number of bets:

```json
{
  "bets": [
    { "bet_type": "single", "legs": [{ "market": "MONEYLINE", "...": "..." }] },
    { "bet_type": "parlay", "legs": [{ "...": "..." }, { "...": "..." }] }
  ]
}
```

The flat format still works and is the same as one bet when `bet_count` is 1. A flat file with
`bet_count` above 1 has unknown grouping: its legs are scored, but not its grouping. Use either
`bets` or `legs`, never both. `--draft-expected` writes drafts in the grouped format.

From the repository root, with `ANTHROPIC_API_KEY` already set locally (never paste keys):

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @pivot/api exec tsx src/slipModelEval.ts /absolute/path/to/slips
```

Default behavior remains one read per image per hardcoded candidate, raw bytes, console only.
Fresh reads are paid API calls; never run fresh reads in CI. `--rescore` is offline. Options:

- `--models id1,id2`: choose candidates. `--price id=4:20` overrides USD per million input/output
  tokens; repeat for multiple models. Every model must have a supplied or table price, checked
  before reads. The table is an unverified estimate; confirm current provider rates yourself.
- `--runs 3`: repeat the entire set three times per model; report per-run mean/min/max field
  accuracy (fractions from 0 to 1) and total cost (USD). Failed reads stay in accuracy denominators.
- `--as-app` or `--as-app=ios`: JPEG quality 70, no resize, from native `quality: 0.7` in
  `app/lib/slipImage.ts`. `--as-app=web`: JPEG quality 85, longest edge at most 2000px, never
  upscale, from `SLIP_IMAGE_MAX_EDGE = 2000` and `toDataURL('image/jpeg', 0.85)` in
  `app/lib/slipImage.web.ts`. Sharp approximates the profiles; platform encoders need not produce
  identical bytes. The pinned API devDependency is loaded lazily only with this flag.
- `--out FILE`: JSON includes options, prices, per-image/model/run reads, wrong fields (expected
  versus got), counts, tokens, cost, latency and failures. `--out` alone defaults to the gitignored
  `experiments/slip-eval/results.json` (relative to the API package working directory). Custom
  paths outside that directory are your responsibility. Output contains slip data; keep it private.
- `--draft-expected`: first model's first run, when successful, writes `name.expected.draft.json` with
  an UNVERIFIED marker. Existing drafts are never overwritten. Missing expected files are allowed
  only here; such images are read but excluded from scores. Review every field, remove metadata
  and create `name.expected.json` yourself. Draft files are never loaded as ground truth; expected
  files still bearing the verification marker are rejected. Draft generation is not validation.
- `--production-path`: run the unchanged `AnthropicSlipReader`, including its pinned model,
  beta and fallback parameters. Omit `--models`. Observed tokens use the pinned model's price;
  server-side fallback billing cannot be verified by this harness. This is a request-shape smoke
  check, not a controlled model comparison.

Both positional and order-insensitive best-assignment field scores are printed. Assignment
maximizes total correct fields with one-to-one matching; missing legs score wrong and extra
legs fail the leg-count check. Team names use `resolveTeam` with a static 32-team fixture:
DET, Lions and Detroit Lions match. Unknown/ambiguous team strings are wrong; two absent
(null) team values match. Player names retain punctuation/case normalization.

Failed reads have unknown tokens/cost (`null`), not a claim of zero billing. Totals and ranges
sum known usage only; don't use them as final bills. Refused or malformed answers may still
cost money. Inspect failures and leg/bet counts alongside field accuracy.

The legacy `slipImportEval.ts` still works without flags; with flags it delegates to the
production-path CLI. Paste reviewed results into `docs/SLIP-MODEL-EVAL.md` only after real runs.

## Offline import outcome scoring (#118)

The raw positional and best-assignment scorecards are unchanged. A second, positional
scorecard compares the conditions built by the real `buildCondition` (including its
`overUnder` defaults), and resolves teams with `resolveTeam` and `EVAL_TEAMS`.
Each leg is `match`, `flagged`, or `silent_wrong`. Player-team differences remain matches
with informational `team_differs: blank | different` metadata, counted separately.
Team-based legs require a resolvable team; a missing/unknown team is flagged and a different
team is silently wrong. Expected-null teams do not penalize team differences.

Slip outcomes are `unreadable`, `false_accept`, `rejected_multiple_bets`, and
`silent_wrong_grouping`. `unreadable` and `false_accept` take precedence: their legs are not
counted as imported picks.

The import outcome scores what the multi-bet client (`?multi_bet=v1`) would import:

- `rejected_multiple_bets` is now a legacy-contract annotation: the read says more than one bet
  (by count or grouping) on a single-bet slip, so iOS 1.1.0 would refuse it. The slip's legs
  are still scored, because a multi-bet client imports that read. Before multi-bet import these
  legs were not scored, so `silent_wrong` and `flagged` from older runs aren't directly
  comparable; re-score old results to compare.
- `review` counts imports the multi-bet client would show for a leg-by-leg check with nothing
  preselected: the confirm pass failed or disagreed (production path only; the record's
  `confirmation`), or the read is inconsistent (count differs from its bets, an empty bet, a
  bet type that doesn't match its leg count, or no grouping with a count above 1). In review, a
  leg that would be `silent_wrong` counts as `flagged`.
- `grouping_correct` / `grouping_wrong`: whether the read split legs into bets the way the slip
  does (legs matched by the best assignment; bets must correspond one to one; order of bets
  doesn't matter). Skipped when either side's grouping is unknown.
- `silent_wrong_grouping`: wrong grouping on a read that is not in review. The multi-bet client
  would preselect the wrong bets (for example, save two singles instead of one parlay).
- `multi_bet_slips` / `multi_bet_grouping_correct`: the multi-bet grouping-accuracy metric,
  over every expected slip with more than one bet. A refused or unreadable read counts as wrong.
  The report prints it as `multi-bet slips: n/d (p%)`, next to overall grouping accuracy.

The launch gate for multi-bet import is **silent_wrong 0, silent_wrong_grouping 0, and
rejected_multiple_bets 0** on the production path. Missing legs
on otherwise accepted slips are flagged; extra ready legs are silently wrong. Unsupported
reads are flagged even when ground truth is also unsupported. Counts and per-run count
mean/min/max appear per model; each JSON record includes its leg and slip outcomes.

This is a condition/team projection, not a complete import simulation. It cannot check
player uniqueness, player identity, this week's schedule, printed matchups/dates, or database
validation. Player-team differences are informational because unique names are authoritative;
production uses the team only to disambiguate names. No player or game data is fetched.

Re-score a saved version-1 results file for free, with no API key and no screenshots needed:

```bash
pnpm build
env -u ANTHROPIC_API_KEY pnpm --filter @pivot/api exec tsx src/slipModelEval.ts --rescore ~/slip-results.json
```

By default it uses the saved `options.dir` (relative paths still resolve from the API package
working directory). To move the ground truth directory, pass its absolute path first:

```bash
env -u ANTHROPIC_API_KEY pnpm --filter @pivot/api exec tsx src/slipModelEval.ts /absolute/path/to/slips --rescore ~/slip-results.json --out ~/slip-results-rescored.json
```

Only reviewed `<image-base>.expected.json` files are loaded. Missing files and UNVERIFIED
markers fail the command. Every stored read is re-scored against the current ground truth,
including formerly draft-only records if reviewed expected files now exist. Existing usage,
cost, latency, failure and read data are preserved. The input file is unchanged unless you
explicitly choose it as `--out`; without `--out`, rescoring prints reports only. Read-time
flags (`--models`, `--runs`, `--as-app`, `--production-path`, `--draft-expected`, `--price`) do
not run in rescore mode.
