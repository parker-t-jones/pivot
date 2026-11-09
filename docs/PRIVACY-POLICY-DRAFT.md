# Privacy policy — draft text (issue #33)

For Parker to review, edit, and have checked by a lawyer before pasting into the marketing site
(`pivot-sports-site`, not attached to this session — see the PR for exactly what to paste where).
This is plain-language draft text, not final legal copy. Anywhere a product decision is implied
("how long we keep X"), it reflects what `docs/PRIVACY-INVENTORY.md` found in the actual code —
check that table if a sentence here seems to assume something.

---

## What Pivot collects and why

**Account info.** Your email and password (through our login provider, Supabase) so you can sign
in. We never see your plaintext password.

**Your picks.** Fantasy lineups you connect (via Sleeper) or enter manually, and the bets you add
— spreads, totals, moneylines, player and team props, parlays, and survivor picks. This is the
core of the app: we use it to figure out which live game matters to you right now.

**Fantasy league connection.** If you link a Sleeper league, we store the league ID and your
roster ID so we can read your lineup. We never ask for or store your Sleeper password — the
connection uses Sleeper's public roster data, not a login.

**Streaming services you have.** Which services you've told us you subscribe to (e.g. YouTube TV,
Prime Video, cable), so we can send you a working "Watch on {service}" link instead of a dead end.

**Notification settings.** How you want to be alerted — all alerts, only the important ones, or
none; quiet hours; whether alerts should arrive a little later to match how far behind your stream
runs.

**Push notification info.** A device token (for iOS) or a browser subscription (for web) so we can
actually deliver an alert to your device. For web, this is handled through your browser's own push
service — we don't know or control which company's servers relay it.

**What you're currently watching.** A single "viewing session" record — which game you're on and
which device — so Home can show you what's live right now.

**Saved stream links.** If you paste in a direct link to a stream for a specific game (useful when
we can't resolve one automatically), we save it so you don't have to re-paste it.

**Subscription status.** Whether you're on the free plan or Pro. Billing itself (your payment
method, receipts) is handled entirely by our payment partner, RevenueCat — we only receive whether
your subscription is active, not your card details.

**Delivery and debugging records.** A log of which alerts we computed and sent you, used to avoid
duplicate alerts and to debug problems.

## Importing a bet slip from a photo (coming soon — not live yet)

We're building a feature where you can upload a photo of your bet slip and we'll read the legs for
you to confirm, instead of typing each one in. When this ships:

- The photo is sent directly from our server to an AI model (Anthropic) that reads it and returns
  the legs as structured data (player, bet type, line). The photo is never sent from your device
  to Anthropic directly, and never leaves our systems except for that one request.
- **We do not save the photo or the AI's raw response.** Both exist only for the moment it takes to
  process your upload; we only keep counts (so we can enforce a daily limit) and error details if
  something goes wrong.
- You always review and confirm the extracted legs before anything is saved as a pick.
- This feature is not available in the app yet. We'll update this policy and notify the App Store
  of the change before it ships.

## Who else sees your data

- **Supabase** hosts our database and handles login. They store everything in the "What Pivot
  collects" section above on our behalf.
- **Fly.io** runs our servers.
- **Expo / Apple** deliver push notifications to your iPhone.
- **Your browser's push service** delivers push notifications on the web.
- **RevenueCat** manages subscriptions and tells us whether you're on Pro.
- **Sleeper** is queried, read-only, for your fantasy roster if you connect a league — we send them
  no personal information beyond the league/roster IDs you give us.
- **Anthropic** will process bet-slip photos once that feature ships (see above) — not yet.
- We use error-monitoring tooling (Sentry) for parts of our backend; it currently does not receive
  any information that identifies you.

We do not sell your data. We do not show you ads. **Pivot never takes bets, never shows promo
codes or sportsbook affiliate links, and never encourages you to place a bet** — we only help you
find the game that matters to you.

## How long we keep things

Most of what's listed above is kept for as long as your account exists, so the app keeps working
the way you set it up. Streaming-service selections, notification settings, and saved stream links
update whenever you change them. Stale push subscriptions (e.g. a browser you no longer use) are
removed automatically when we detect they've stopped working.

## Deleting your account

You can delete your account from Settings. This permanently removes your profile, picks, fantasy
league connections, streaming-service selections, notification settings, saved stream links,
viewing history, and push subscriptions from our systems. This is enforced at the database level,
not just by our app's delete button, so it can't drift out of date as we add features.

One limit: your subscription record with our payment processor, RevenueCat, is not deleted by this
action today — their own data practices govern that record. [Flag for Parker/legal: decide whether
to add a RevenueCat-deletion step before launch, or disclose this limit plainly, e.g. "billing
records are retained by our payment processor per their own policy."]

## Changes to this policy

[Standard legal boilerplate — have a lawyer draft this paragraph properly; do not ship a
generic placeholder.]

## Contact

[Parker: add a real contact email/method here.]

---

### Notes for Parker (remove before publishing)

- Every factual claim above ("we do not save the photo", "stale subscriptions are removed
  automatically") is backed by a specific file in `docs/PRIVACY-INVENTORY.md` — re-check that table
  before editing this draft, since a wording change here should track a real code change, not the
  other way around.
- The bet-slip section describes issue #12's *design*, which is not yet merged. Don't let this
  section go live before the feature does, and re-verify the "we don't save it" claim against the
  actual implementation when it ships — that's a promise this document is making on the code's
  behalf.
- This is not legal advice. Have the final text reviewed by a lawyer, especially the RevenueCat
  retention carve-out and the "Changes to this policy" / contact sections, which are left as
  placeholders on purpose.
