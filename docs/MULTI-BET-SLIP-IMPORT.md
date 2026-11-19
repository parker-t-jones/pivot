# Multi-bet screenshot slip import

Status: built on `feat/multi-bet-slip-import`, not deployed. Needs the paid acceptance run
(below) before the API goes out.

## Recon: how import worked before

| Piece                    | Where                                                                                                                          | Behavior before this change                                                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Model schema             | `services/api/src/lib/slipImport/schema.ts`                                                                                    | `{ is_bet_slip, bet_count, legs[] }`. Flat legs, no per-bet grouping.                                                                                                                                                                            |
| Prompt                   | `SLIP_READ_PROMPT` in `lib/slipImport/reader.ts`                                                                               | "Count bets, not legs"; `bet_count > 1` only for separate bets with their own pick amount or payout.                                                                                                                                             |
| Readers                  | `reader.ts`                                                                                                                    | `AnthropicSlipReader` on `claude-haiku-5-5`. `ConfirmingSlipReader` re-reads on `claude-sonnet-5-5` only when the primary says `is_bet_slip` with `bet_count > 1`, and returns the confirm read (or the primary read if the confirm call fails). |
| Route                    | `services/api/src/routes/pickImport.ts`, `POST /picks/import`                                                                  | Body `{ image }`, `.strict()`. Answers `{ kind: 'single' \| 'parlay', legs, imports_left }`.                                                                                                                                                     |
| 422 path                 | same                                                                                                                           | `bet_count > 1` after confirmation: 422 `slip_import_multiple_bets`. More than 12 legs: 422 `slip_import_too_many_legs`. Not a slip or no legs: 422 `slip_import_unreadable`.                                                                    |
| Quota                    | `lib/slipImport/quota.ts` + route                                                                                              | One INCR per request on `slip_import:{user}:{season}:{week}` (free 3, Pro 10). Given back only on 502 (the Claude API failed). The multiple-bets 422 kept the import spent.                                                                      |
| Free pick cap            | `POST /picks`, client `freePicksLeft`                                                                                          | Free is 3 bet legs per week; each parlay leg counts; Pro unlimited. Enforced on save with 403 `stake_limit_free`.                                                                                                                                |
| Choose legs (#111, #112) | `app/components/AddPickFlow.tsx`                                                                                               | When a free user's ready legs exceed picks left, the user selects up to that many ("You have N free picks left this week. Choose up to N of these M legs."). One leg opens single review; two or more open parlay review.                        |
| Client import UI         | `AddPickFlow.tsx`, `SlipImportButton.tsx` / `.web.tsx`, `slipImportShared.ts`, `app/lib/slipImport.ts`                         | One shared flow for iOS and web (react-native-web). `slipImportShared.ts` holds the label and props so `SlipImportButton.web.tsx` never imports its own base module; `scripts/webPlatformImports.test.ts` enforces that rule.                    |
| Eval                     | `experiments/slip-eval/`, `services/api/src/slipModelEval.ts`, `lib/slipImport/{evalScore,importOutcome,modelEval,rescore}.ts` | Positional and best-assignment field scores; import-outcome projection (`match` / `flagged` / `silent_wrong`, slip `rejected_multiple_bets` / `unreadable` / `false_accept`). A refused slip's legs were not scored. Offline `--rescore`.        |

## Contract

The client opts in with a query parameter: `POST /picks/import?multi_bet=v1`.

Why a query parameter: the deployed API's body schema is strict, so a new body field would be a
400 from the current API; and a custom header would fail the web app's CORS preflight
(`Authorization` and `Content-Type` only) against the current API. Every API version ignores an
unknown query parameter, so the new client works against the old API (it gets the old contract
and uses the old flow) and the old client works against the new API.

**Legacy clients** (no parameter, or any value other than `v1`; this is iOS 1.1.0 build 15 and
any cached web build) get exactly the original response: `{ kind, legs, imports_left }`, no new
keys, and the same 422 `slip_import_multiple_bets` with the same message. A read counts as
multiple bets when its count says so or when it is grouped into more than one bet. The only
change they see: that 422 now gives the import back.

**Multi-bet clients** get the original keys (flat `legs` across all bets) plus:

```json
{
  "kind": "parlay",
  "legs": ["...every leg, in order..."],
  "imports_left": 2,
  "bets": [
    { "bet_type": "single", "legs": ["...ImportedLeg..."] },
    { "bet_type": "parlay", "legs": ["...", "..."] }
  ],
  "review": false
}
```

`bet_type` reuses the existing `kind` enum (`single` / `parlay`) and is derived from each bet's
leg count. Legs keep their existing shape (`ready` with a pick, or `flagged` with a reason).
Limits: at most 10 bets (422 `slip_import_too_many_bets`) and 12 legs per bet (422
`slip_import_too_many_legs`). Nothing is saved by the import.

## Decisions

1. **Grouping.** The model returns `bets: [{ bet_type, legs }]` (legs unchanged) next to
   `bet_count`. Internally a read stays flat (`legs`) plus `bets: [{ bet_type, leg_count }]`
   spans, so the mapper, the eval scorers, and old saved results keep working.
2. **Backward compatibility.** Gated on `?multi_bet=v1` as above. Tests prove the legacy shape
   (exact key set) and the 422.
3. **Quota.** One screenshot is one import regardless of bet count. The legacy multiple-bets
   422 refunds the import. Both are tested.
4. **Free cap.** The #111/#112 rule is reused across all bets: every leg uses one pick, legs are
   grouped by bet, and a free user selects up to the picks left. Each bet with a selected leg
   saves on its own (`POST /picks`): one leg as a pick, two or more as a parlay. A parlay cut to
   one leg saves as a single pick, as in #111. Pro saves everything. `POST /picks` stays the
   authority (403 `stake_limit_free`).
5. **Confirm pass and the disagreement rule.** The trigger is unchanged in spirit: the Sonnet
   re-read runs when the Haiku read is a bet slip with more than one bet (by count or grouping).
   It no longer leads to a refusal for multi-bet clients; it decides whether the import needs
   review. Two reads **agree** only when both are bet slips, neither is inconsistent, and they
   hold the same bets: the same number, and per bet the same type and the same multiset of legs
   compared on every pick-deciding field (market, stat, player, team, side, line, N+ style,
   period). Bet order, leg order within a bet, printed text, and odds are ignored; names are
   compared case- and punctuation-insensitively. Fields are compared as the pick they become:
   a team leg's team is compared as the NFL team it names (`CHI`, `CHI Bears` and
   `Chicago Bears` agree); a player leg's team is ignored (the player is matched by name); a
   blank side on a touchdown-scorer leg counts as YES and on an `N+` line as OVER, the same
   defaults the mapper applies. Anything that changes a pick still disagrees. (The first
   version compared team text and sides exactly; the Nov 18 production-path eval sent 30 of 30
   correctly grouped multi-bet reads to review because of that.)
   - Agree: the confirm read is imported, preselected as usual.
   - Disagree: the confirm read (the stronger model) is returned with `review: true`.
   - Confirm call fails: the primary read is returned with `review: true`.
   - A read that is inconsistent on its own (count differs from its bets, an empty bet, a
     one-leg parlay or two-leg single, or no grouping) is also `review: true`.
     Review means the client shows every bet's legs with nothing preselected and a sentence
     asking the user to check each pick. Nothing is ever saved without the user tapping Add.
6. **Client UI.** `app/components/AddPickImportBets.tsx`, shared by iOS and web (no `.web`
   file, so the self-import guard is not involved). Each bet sits under a header such as
   "Bet 1 · Parlay · 3 legs" or "Bet 2 · Single"; each matched leg has Select / Deselect and
   shows what the slip printed; legs Pivot couldn't match are shown with the reason and "This
   leg won't be added." Copy says "pick", in full sentences. Theme tokens and `ListRow`,
   `PrimaryButton`, `SecondaryButton`, `TextButton` only. A screenshot with one bet and no review
   keeps the existing one-bet flow (single review, or the parlay screen with Edit), so nothing
   changes for the common case. Editing a leg is not offered in the multi-bet review; the user
   deselects a wrong leg and adds it by hand. If a later save fails, the bets already saved leave
   the list and the message says how many were added.
7. **Eval.** `*.expected.json` accepts the grouped `bets` format and the old flat format.
   New tallies: `review`, `grouping_correct` / `grouping_wrong`, `silent_wrong_grouping`, and
   the multi-bet grouping-accuracy metric (`multi_bet_grouping_correct / multi_bet_slips`).
   `silent_wrong` and `rejected_multiple_bets` remain; `rejected_multiple_bets` is now a
   legacy-contract annotation and no longer stops leg scoring. See
   `experiments/slip-eval/README.md`.
8. **Models.** Unchanged: Haiku primary, Sonnet confirm.

## Rollout

- **API** (Fly): deploy before or after the app; either order is safe because of the query
  parameter. The prompt and schema changed, so run the paid acceptance eval first.
- **App:** update-safe (JS and copy only; no native package, `app.json`, or SDK change). Web
  ships on merge. iOS 1.1.0 keeps the legacy contract until Parker publishes an update.

## Acceptance (paid, Parker's Mac)

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @pivot/api exec tsx src/slipModelEval.ts /absolute/path/to/slips --production-path --runs 10 --out /absolute/path/to/multibet-production-results.json
```

Accept when: `silent_wrong` 0, `silent_wrong_grouping` 0, `rejected_multiple_bets` 0, no new
`false_accept` versus #126, and `review` low (each review is a slip the user must select by
hand). Add at least two real multi-bet screenshots in the grouped format to see multi-bet
grouping accuracy; the prod-accept set is single-bet slips only.
