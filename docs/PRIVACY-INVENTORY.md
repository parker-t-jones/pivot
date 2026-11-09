# Privacy data inventory

Built for issue #33. Every row below is traced to the actual migration or route that creates it —
file references are given so this doesn't drift the way the policy it feeds has. "Deleted on
account deletion" is **Yes** only where verified in this pass (recon in services/api/src/routes/me.ts
`DELETE /me`, confirmed against every migration's `ON DELETE` clause, and locked in by
`services/api/src/lib/accountDeletionCascade.test.ts`, added in this PR).

Not legal advice. Parker should have the final policy text reviewed by a lawyer before publishing.

## How account deletion works

`DELETE /me` (`services/api/src/routes/me.ts`) does one thing: `supabase.auth.admin.deleteUser(user.id)`.
It does not touch any `public.*` table directly. Every table below that holds a `user_id` (or a
column that chains to one through another table) is declared `... REFERENCES public.users (id) ON
DELETE CASCADE` or chains to such a column, and `public.users.id REFERENCES auth.users (id) ON
DELETE CASCADE`. Deleting the `auth.users` row cascades through the whole graph in one statement.
That means correctness here depends on every future table remembering the cascade, not on this
route being updated — which is why this PR adds a test that creates one row in every table below
and asserts they are all gone after deletion, rather than relying on the route's comment (which was
stale: it only named the five oldest tables).

## Data inventory

| Data | Purpose | Storage (table / column) | Processor | Retention | Deleted on account deletion |
|---|---|---|---|---|---|
| Email | Login identity, Supabase auth | `auth.users`, `public.users.email` (`supabase/migrations/20260510120000_users_user_app_presence.sql`) | Supabase (hosted Postgres + Auth) | Until account deletion | Yes — `auth.users` row is deleted directly; `public.users` cascades |
| Password | Login | `auth.users` (Supabase Auth, hashed) | Supabase | Until account deletion | Yes |
| Notification / app preferences | Personalize alerts (notification mode, quiet hours, auto-switch, opponent nudges, watched leagues, alert-timing delays) | `public.users.preferences` jsonb (`shared/src/types/preferences.ts`) | Supabase | Until account deletion or overwritten | Yes — column on `public.users` |
| Subscription tier (free/pro) | Entitlement gating | `public.users.subscription_tier` | Supabase; written only by the RevenueCat webhook (`services/api/src/routes/billing.ts`) | Until account deletion | Yes |
| Expo push token + device id | Deliver iOS push alerts | `public.users.expo_push_token`, `public.users.expo_push_device_id` (`supabase/migrations/20261010220000_users_expo_push_device_id.sql`) | Supabase (storage); Expo push service / Apple APNs (delivery) | Until cleared (sign-out) or account deletion | Yes |
| Web Push subscription (endpoint, keys, user agent) | Deliver browser push alerts on web | `public.web_push_subscriptions` (`supabase/migrations/20261011190000_web_push_subscriptions.sql`) | Supabase (storage); the browser's push service (e.g. Mozilla/Google endpoint) relays delivery — Pivot never learns which vendor | Until unsubscribed, auto-removed on a 404/410 from the push service (`services/dispatcher/src/webPush.ts`), or account deletion | Yes |
| Is-demo flag | Pin the App Store reviewer account to a fixture | `public.users.is_demo` (`supabase/migrations/20261031170000_users_is_demo.sql`) | Supabase | Until account deletion | Yes (not applicable to real users — only the reviewer account has this set) |
| Fantasy league link (Sleeper) | Compute "your player has the ball" | `public.leagues` (`platform`, `external_league_id`, `external_owner_id`, `external_roster_id`, `name`) (`supabase/migrations/20260709220000_leagues_lineup_slots.sql`) | Supabase (storage); Sleeper's public read-only API (`services/api/src/providers/sleeper-client.ts`) is queried with the league/user id the user supplies — no Sleeper credentials are ever sent or stored | Until the league is removed or account deletion | Yes — `leagues.user_id ... ON DELETE CASCADE` |
| Fantasy lineup (manual or synced) | Which players are "yours" each week | `public.lineup_slots` (via `league_id`) | Supabase | Re-synced/overwritten weekly; removed with the league | Yes — cascades via `leagues` |
| Streaming-service selections | Route "Watch on {service}" to the right deep link; detect broadcast availability | `public.user_app_presence` (`supabase/migrations/20260510120000_users_user_app_presence.sql`) | Supabase | Until changed or account deletion | Yes |
| Picks: spreads, totals, moneylines, player/team props, parlays, survivor picks | The core feature — flag the game that matters | `public.stakes` (`subject`, `condition`, `source`, results) (`supabase/migrations/20261008014500_stakes.sql`, extended by `20261104210000_stakes_opponent_team_name.sql` and `20261109120000_picks_props_parlays.sql`) | Supabase | Until the pick is deleted or account deletion; settled picks are kept for history unless deleted | Yes |
| Parlay slips | Group prop legs into one pick toward the free cap | `public.pick_slips` (`supabase/migrations/20261109120000_picks_props_parlays.sql`) | Supabase | Same as stakes | Yes |
| Stake trigger log (nudge/reveal firing record) | Resumption-timing bookkeeping | `public.stake_trigger_log` (`supabase/migrations/20261008014500_stakes.sql`) | Supabase | Until the parent stake is deleted or account deletion | Yes — cascades via `stakes` |
| Spent free-pick slots | Keep a free weekly slot "spent" after removing a started pick | `public.stake_spent_slots` (`supabase/migrations/20261108200000_stake_spent_slots.sql`) | Supabase | Until account deletion (no independent expiry — persists even after the pick itself is gone, by design) | Yes |
| Flag/notification delivery log | Record of what was flagged and delivered, for dedupe and debugging | `public.flag_events` (`supabase/migrations/20260712160000_flag_events.sql`) | Supabase | No active cleanup job found; grows until account deletion | Yes |
| Viewing session (what you're watching now, device info) | Power Home's "now watching" state and thumbnails | `public.viewing_sessions` (`supabase/migrations/20260712230000_viewing_sessions.sql`) | Supabase | One row per user, overwritten live; until account deletion | Yes |
| Saved stream link (pasted URL per game) | Let a user pin a direct stream link Pivot can't resolve itself | `public.user_game_links` (`supabase/migrations/20261016020000_user_game_links.sql`) | Supabase | Until removed or account deletion | Yes |
| Subscription / billing identity | Grant Pro access | RevenueCat's own systems (keyed by the Pivot user id as `app_user_id`); Pivot only stores the resulting tier (`public.users.subscription_tier`) | RevenueCat (external processor) | Governed by RevenueCat's own retention; Pivot has no delete hook into RevenueCat today | **No** — flagged below |
| Bet-slip screenshot image | **Not yet shipped.** Issue #12 ("Import a bet slip from a screenshot") is still open, unmerged, and not in the codebase as of this PR — there is no screenshot upload route, no Anthropic/vision API call, and no image-handling code anywhere in the repo. The design in #12 specifies the image and model output are processed in memory per-request and never persisted (only counts/errors logged), which is consistent with everything else in this inventory, but it describes planned behavior, not shipped behavior. | N/A — nothing exists yet | Anthropic (planned, per #12's design) | N/A | N/A |
| Error reports (Sentry) | Debugging | None in `public.*` — handled entirely by Sentry, an external processor | Sentry — **but see note below: Sentry is wired (`shared/src/observability/sentryErrorReporter.ts`) and used for exactly one call site today, `services/ingestion/src/espn/errors.ts`, which only reports ESPN feed errors (play ids, HTTP status) — no user id, email, or pick data is ever passed to it.** No service calls `initSentry()` from a running entry point yet, so in practice Sentry is not currently receiving any events in production. | Governed by Sentry's own retention once it is wired up | Not applicable (no user-identifying data flows there today) |
| Compute / request logs | Operate the service | Fly.io's own platform logs (API/worker/runner process output) | Fly.io | Governed by Fly's own log retention | **No** — flagged below (not Pivot's own deletable store; standard platform log retention) |

## Processors referenced above, for the "who processes it" section of the policy

- **Supabase** — hosts every `public.*` table and `auth.users`. Processes all of the above.
- **Fly.io** — runs the API, worker, and runner processes; sees request/compute logs, not a separate data store.
- **Expo push service / Apple APNs** — relays iOS push notification payloads (game/alert text, not account data) using the Expo push token.
- **Web Push services** (browser-vendor push endpoints, e.g. Mozilla's or Google's) — relay Web Push payloads using the subscription endpoint/keys; Pivot's code never learns which vendor a given endpoint belongs to.
- **RevenueCat** — manages subscription purchases and entitlements; receives the Pivot user id as `app_user_id` and purchase/entitlement events; is the source of truth for `subscription_tier`.
- **Sleeper** — a third-party fantasy platform whose public, unauthenticated read API Pivot queries with a league/user/roster id the user supplies, to read roster and matchup data. No Sleeper password or OAuth token is ever sent to or stored by Pivot.
- **Sentry** — wired for error reporting but, as of this PR, only invoked from the ESPN ingestion adapter with non-user data (see above). Flagged for Parker: decide and document whether/when it gets wired into user-facing request paths, and if so, confirm `sendDefaultPii` stays off (it is not currently set, which defaults to off in the Node SDK) before that happens.
- **Anthropic** — not currently integrated (see bet-slip screenshot row above). Add this processor to the policy only once #12 ships; the design commits to in-memory-only processing with no image/model-output persistence, so document that constraint when it does ship, and verify the implementation actually matches it at that time.

## Open items for Parker (flagged, not guessed)

1. **RevenueCat deletion**: Pivot's account deletion does not — and architecturally cannot from this codebase alone — delete the user's subscriber record in RevenueCat. If the policy promises "we delete all your data," this is the one external gap. Needs either a RevenueCat API call added to the deletion path (a backend/infra change, out of scope for this docs-only PR) or policy language carving out billing records kept by the payment processor, which is a common and usually compliant carve-out but should be worded by a lawyer.
2. **Fly.io / Supabase platform logs**: standard infrastructure logs (HTTP access logs, Postgres logs) are not deleted by the app's account-deletion path; they age out under each vendor's own retention. This is normal and usually doesn't need to be itemized, but flag it so Parker can decide whether to mention it.
3. **Screenshot import (#12)**: not shipped. Don't publish policy language describing it as current behavior. Draft language is included in `docs/PRIVACY-POLICY-DRAFT.md` as a clearly-marked "when this ships" section so Parker doesn't have to write it twice, but it should not go live until #12 merges and its in-memory-only handling is verified against the actual implementation.
4. **Sentry scope**: not currently receiving any user data (see processor note above). Re-check this inventory if/when Sentry is wired into user-facing routes — that's a code change, not a docs change, and should come with its own PII-scrubbing review.
