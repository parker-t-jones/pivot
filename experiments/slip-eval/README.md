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

From the repository root, with `ANTHROPIC_API_KEY` already set locally (never paste keys):

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @pivot/api exec tsx src/slipModelEval.ts /absolute/path/to/slips
```

Default behavior remains one read per image per hardcoded candidate, raw bytes, console only.
These are paid API calls; never run the CLI in CI. New options:

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
