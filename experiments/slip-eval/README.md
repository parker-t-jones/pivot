# Bet slip import eval set (#12)

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
props, spreads, totals, and a quarter or half line.

Run (costs one Claude API call per screenshot):

```bash
ANTHROPIC_API_KEY=... pnpm exec tsx experiments/slip-import-eval.ts
```
