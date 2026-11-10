# Bet slip import eval set (#12, #41)

Real bet slip screenshots for measuring the screenshot reader, with what each one should read as.

**Blur first.** Before committing a screenshot, blur or crop out the account balance, username,
bet ID, stake, payout, and any promotion. Leave the legs, lines, sides, and team names readable.
Don't commit sportsbook logos if you can crop them out.

For each `<name>.png` (or `.jpg`), add `<name>.expected.json`:

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

Field values are the ones in `services/api/src/lib/slipImport/schema.ts`. Write `line` and
`side` as printed: "60+" is `line: 60`, `plus_style: true`, `side: "OVER"`.

Aim for a mix: DraftKings, FanDuel, and at least one other book; singles and parlays; player
props, spreads, totals, and a quarter or half line. Include at least one image that is **not** a
bet slip (a home screen, a different app) with `"is_bet_slip": false` in its expected JSON, to
check that the reader doesn't invent legs for it:

```json
{ "bet_count": 0, "legs": [], "is_bet_slip": false }
```

Run against the production model only (costs one Claude API call per screenshot):

```bash
ANTHROPIC_API_KEY=... pnpm --filter @pivot/api exec tsx src/slipImportEval.ts ../../experiments/slip-eval
```

Run the #41 model comparison (Opus 5.5 vs. Sonnet 5.5 vs. Haiku 5.5 — costs one call per
screenshot **per model**, so three times the above):

```bash
ANTHROPIC_API_KEY=... pnpm --filter @pivot/api exec tsx src/slipModelEval.ts ../../experiments/slip-eval
```

Paste the printed comparison table into `docs/SLIP-MODEL-EVAL.md` and fill in the recommendation.
