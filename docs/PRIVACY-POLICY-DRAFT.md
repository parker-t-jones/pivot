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

## Importing a pick from a screenshot

You can add a pick by uploading a screenshot of a bet slip instead of typing it in. Pivot reads the
screenshot and fills in the legs for you to review.

- Your screenshot is sent from the app to our server, and from our server to an AI model run by
  Anthropic, which reads it and returns the legs as structured data (player, bet type, line). The
  app never sends it to Anthropic directly.
- **We do not save your screenshot or the AI's raw answer.** Both exist only for the moment it takes
  to process the request. We keep a count of how many imports you have used this week, so we can
  enforce the weekly limit, and we log counts and error types if something goes wrong. We do not
  log the image or what was read from it.
- Anthropic handles the screenshot under its API terms. As of this draft, Anthropic says it does not
  use API inputs or outputs to train its models by default and deletes them from its systems within
  30 days, with limited exceptions such as content flagged for violating its usage policy or
  retention required by law. [Parker: re-check this against Anthropic's current commercial data
  retention page before publishing, and keep this paragraph in step with it.]
- Nothing from the screenshot becomes a pick until you review the legs and save them. A screenshot
  may show personal details such as a name, account number or balance. Crop those out if you would
  rather Anthropic not receive them; Pivot only uses the legs.

## Who else sees your data

- **Supabase** hosts our database and handles login. They store everything in the "What Pivot
  collects" section above on our behalf.
- **Fly.io** runs our servers.
- **Expo / Apple** deliver push notifications to your iPhone.
- **Your browser's push service** delivers push notifications on the web.
- **RevenueCat** manages subscriptions and tells us whether you're on Pro.
- **Sleeper** is queried, read-only, for your fantasy roster if you connect a league — we send them
  no personal information beyond the league/roster IDs you give us.
- **Anthropic** reads the screenshot when you import a pick from one (see above). It receives the
  image only, from our server, with nothing that identifies you.
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
- The screenshot-import section describes shipped code (#12, `services/api/src/routes/pickImport.ts`;
  verified for this draft: the image and the read stay in memory, and the only log lines carry
  counts and error kinds). Publish it **before** the production `ANTHROPIC_API_KEY` is set, since
  that is what turns the feature on. Re-verify the "we don't save it" claim whenever the import
  route or readers change: it is a promise this document makes on the code's behalf.
- The sentence about Anthropic's retention and training is Anthropic's published policy, not ours.
  It can change; check it on the day you publish.
- This is not legal advice. Have the final text reviewed by a lawyer, especially the RevenueCat
  retention carve-out and the "Changes to this policy" / contact sections, which are left as
  placeholders on purpose.
