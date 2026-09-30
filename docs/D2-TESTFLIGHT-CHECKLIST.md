# D2 — TestFlight on the hosted backend

**Owner:** Parker. Every step below is **[Parker]**; nothing here was run by Cursor.
**Today:** Wednesday, Sep 30, 2026 — the only deploy day this week. No backend deploys Thursday, Sunday or Monday. Beta users go live Sunday.

Where this differs from `docs/D1-DEPLOY-RUNBOOK.md` or `docs/FLY-DEPLOY-CHECKLIST.md`, this file wins:

- **Upstash is the Fixed 250 MB plan, not free** (§B; the free tier runs out in about a day).
- **`PUSH_DRIVER=expo` is set** (D1 said leave it unset).
- **Teams seed uses `supabase db query`.** D1 §4.4's `supabase db execute` does not exist in CLI 2.109.
- **There are 14 migrations**, not 10.

Run everything from the repo root unless the step says `app/`. Use `pnpm exec supabase` (CLI 2.109.1), `fly` ≥ 0.4, and `eas-cli` ≥ 21.

Values in `<ANGLE_BRACKETS>` come from a dashboard or password manager. Never commit them. `.env.production` stays gitignored.

---

## A. Hosted Supabase

### A1. Project
If not already created: [supabase.com/dashboard](https://supabase.com/dashboard) → New project, region **East US (North Virginia)**. Save these in your password manager: the Project URL, `anon` key, `service_role` key, JWT secret (Settings → API → JWT Settings, legacy secret), and DB password.

### A2. Link
```bash
pnpm exec supabase login
pnpm exec supabase link --project-ref <REF>
```
**Expect:** it asks for the DB password, then prints `Finished supabase link.`
**Check:** `cat supabase/.temp/project-ref` → `<REF>`. `git diff --stat supabase/config.toml` → empty (`project_id` stays `FantasyFocusApp`).

### A3. Migrations
```bash
pnpm exec supabase db push --linked --dry-run
pnpm exec supabase db push --linked
```
**Expect:** the dry run lists the migrations not yet applied (all 14 on a fresh project, `20260510120000_users_user_app_presence.sql` … `20260928021000_drop_game_broadcasts.sql`). The real push asks `[Y/n]`, then prints `Finished supabase db push.`
**Check:** `pnpm exec supabase migration list --linked` → Local and Remote columns match for all 14 rows.

### A4. Teams (32 rows from `supabase/seed.sql`)
`db push` does not run the seed. `seed.sql` is a plain `INSERT` of the 32 NFL teams, so run it **once**:
```bash
pnpm exec supabase db query --linked "select count(*) from teams"
# only if that printed 0:
pnpm exec supabase db query --linked -f supabase/seed.sql
pnpm exec supabase db query --linked "select count(*) from teams"
```
**Expect:** `count` = `32` after the insert. A second run of the file fails on the unique constraint; that's fine, the rows are already there.

### A5. Players and schedule
Create `.env.production` in the repo root containing `SUPABASE_URL=https://<REF>.supabase.co` and `SUPABASE_SERVICE_ROLE_KEY=<service_role>`. `git status` must not list it.
```bash
pnpm seed:players -- --env-file .env.production --allow-remote
pnpm seed:schedule -- --env-file .env.production --allow-remote
```
**Expect:**
- `seed:players` prints `Fetching teams from https://<REF>.supabase.co...`, then `Upserting N players (… individual, 32 defenses) …`, then `Done.`
- `seed:schedule` prints `Upserting 321 games from …/data/nfl-schedule-2026.json (49 pre, 272 regular)...`, then `Done. Upserted 321 games.`
- If you omit `--allow-remote`, the script refuses to run. That's the guard working.

**Never** run `pnpm seed:broadcasts` against hosted (it refuses anyway). `game_airings` is written by the runner's airings cycle (§D2).

### A6. Auth settings
Dashboard → Authentication → Providers: **Email on**. Sign In / Up: **Confirm email off**. The app signs in with email and password only.

---

## B. Upstash Redis

### B1. Plan: **Fixed 250 MB ($10/month)**
The estimate is in the appendix. The runner alone issues about 366K commands a day with no games on; a full slate adds 75–100K. That totals about **13M commands a month**.

| Plan (Upstash pricing, checked Sep 30 2026) | Fit |
| --- | --- |
| Free: 500K commands/month, 256 MB | Used up in ~1.2 days. After that Redis rejects commands and the runner stops. **No.** |
| Pay-as-you-go: $0.20 per 100K | ≈ $26/month. A budget cap **stops the database** when reached, which would kill the runner mid-game. |
| **Fixed 250 MB: $10/month flat, no command billing, 50 GB bandwidth, 10K cmd/s** | Our peak is under 100 cmd/s and our data is a few MB. **Yes.** |

Region: **AWS us-east-1 (N. Virginia)**, next to Fly `iad`. If you already created a free database, change its plan in the console before deploying. Don't create a second database.

**Spending cap:** none needed; Fixed has no command overage. Set a billing email alert only. If you ever switch to pay-as-you-go, set the budget to **≥ $40** (about 1.5× the estimate), never lower.

### B2. TCP URL
Console → the database → **Connect** → TCP / ioredis. Copy:
- `REDIS_URL` = `rediss://default:<password>@<endpoint>.upstash.io:6379`
- `PRODUCTION_REDIS_HOST` = `<endpoint>.upstash.io` (the hostname only; no scheme, password or port)

**Check (optional, needs `redis-cli`):** `redis-cli --tls -u '<REDIS_URL>' ping` → `PONG`. `PING` is not billed.

You don't need the REST URL or token: every process uses `REDIS_URL` when it's set.

---

## C. Fly secrets

Secrets are app-wide, so the api, worker and runner all get every one. `--stage` stores them without restarting anything; §D picks them up.

```bash
fly secrets set -a pivot-sports-api --stage \
  SUPABASE_URL='https://<REF>.supabase.co' \
  SUPABASE_SERVICE_ROLE_KEY='<service_role>' \
  SUPABASE_JWT_SECRET='<jwt_secret>' \
  CACHE_DRIVER='redis' \
  REDIS_URL='rediss://default:<password>@<endpoint>.upstash.io:6379' \
  PRODUCTION_REDIS_HOST='<endpoint>.upstash.io' \
  PUSH_DRIVER='expo' \
  REVENUECAT_WEBHOOK_SECRET='<openssl rand -hex 32 output>'
```
Optional ninth: `EXPO_ACCESS_TOKEN='<token>'`, only if "Enhanced push security" is on for the project at expo.dev. Without it, `expo` push still works.

**Do not set:**
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `UPSTASH_REDIS_TCP_URL` (fallbacks only);
- `NODE_ENV` (`fly.toml` sets `production`), `PORT`, `GIT_SHA` (a build arg);
- `SUPABASE_ANON_KEY`, `SEED_*`.

Don't `fly secrets import` a `.env` file.

**Check:** `fly secrets list -a pivot-sports-api` shows exactly these names, in any order, each with a digest:
`CACHE_DRIVER`, `PRODUCTION_REDIS_HOST`, `PUSH_DRIVER`, `REDIS_URL`, `REVENUECAT_WEBHOOK_SECRET`, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` (plus `EXPO_ACCESS_TOKEN` if you set it).

---

## D. Deploy and smoke check (Wednesday only)

### D1. Deploy and scale
```bash
git status --short          # expect: empty
fly deploy -a pivot-sports-api --build-arg GIT_SHA=$(git rev-parse --short HEAD)
fly scale count api=1 worker=1 runner=1 -a pivot-sports-api --yes
fly status -a pivot-sports-api
```
**Expect:**
- The deploy ends with `Visit your newly deployed app at https://pivot-sports-api.fly.dev/`.
- `fly status` lists exactly one machine each for `api`, `worker` and `runner`, all `started`, and the api check `passing`. The api may stop when idle (`min_machines_running = 0`); the next request or WebSocket starts it again.

### D2. Smoke checks
```bash
curl -s https://pivot-sports-api.fly.dev/health
fly logs -a pivot-sports-api --no-tail | grep -E '\[runner\]|\[lineup-sync-worker\]|refusing'
```
**Expect:**
- `/health` → `{"ok":true,"version":"<short sha>"}`, with the same SHA as `git rev-parse --short HEAD`.
- Runner lines, within about 30 s of boot:
  - `[runner] leader <machine-id>:<n>`: this machine holds the lock.
  - `[runner] stake cache: <u> users, <t> teams`: `0 users, 0 teams` is correct before anyone has connected a league.
  - `[runner] airings: <rows> rows across <games> games, <unmapped> unmapped`: rows > 0 means this week's broadcasts are in `game_airings`.
  - `[runner] discovery live=0` (no games on a Wednesday).
- Worker: `[lineup-sync-worker] synced 0 league(s), 0 failed.`
- **No** `refusing` lines. If there is one, it names the missing or wrong secret.

If `airings` logged `airings failed: …` instead, the rest of the runner is fine. Home schedule and sign-in work without airings; only the Switch deep links degrade. Fix it today; there's no second deploy window before Sunday.

---

## E. EAS production environment

Run in `app/`. Use plaintext visibility: `EXPO_PUBLIC_*` values are inlined into the JS bundle, so they're public by design.
```bash
cd app
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value 'https://<REF>.supabase.co' --visibility plaintext --non-interactive
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value '<anon>' --visibility plaintext --non-interactive
eas env:create --environment production --name EXPO_PUBLIC_API_BASE_URL --value 'https://pivot-sports-api.fly.dev' --visibility plaintext --non-interactive
# optional until IAP is tested:
eas env:create --environment production --name EXPO_PUBLIC_REVENUECAT_API_KEY --value '<rc_ios_public_key>' --visibility plaintext --non-interactive
eas env:list --environment production
```
**Expect:** `eas env:list` shows the three (or four) names with your values. If a name already exists, add `--force`.

The API base URL is the bare origin: `https`, no trailing slash, no `/v1`. The app builds `wss://pivot-sports-api.fly.dev/v1/realtime` from it. `app/.env` (the link-local IPs) is gitignored, so it's never uploaded to EAS.

---

## F. Build and submit

### F1. Credentials check
```bash
cd app
eas credentials -p ios
```
**Expect:** bundle `com.fantasyfocus.app` and push key `82JW379P4C`. If there's no distribution certificate or provisioning profile yet, `eas build` creates them in F2 (answer **Yes** to the prompts).

### F2. Build
```bash
eas build -p ios --profile production
```
**Expect:**
- Early output reads `Environment variables loaded from the "production" environment on EAS: EXPO_PUBLIC_API_BASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, EXPO_PUBLIC_SUPABASE_URL…`. If that line is missing or lists no variables, stop: the build would point at nothing.
- A buildNumber increment message (remote version source, `autoIncrement`).
- It ends with `Build finished` and an `.ipa` link, after about 15–25 minutes.
- Version is `1.0.0` (committed). The build number is managed by EAS; `eas build:version:get -p ios` shows it.

### F3. Submit
```bash
eas submit -p ios --profile production --latest
```
**Expect:**
- It asks for your Apple ID, then for the App Store Connect app. If none exists for `com.fantasyfocus.app`, it offers to create one. App names are unique across the App Store, so if "Pivot" is taken, pick a variant; the name under the icon is unaffected.
- It ends with `Submitted your app to Apple App Store Connect!`.
- Apple emails "has completed processing" in 5–30 minutes. There's no export-compliance prompt (`ITSAppUsesNonExemptEncryption` is `false`).

---

## G. TestFlight

### G1. Today: internal group
App Store Connect → the app → TestFlight → Internal Testing → **+** → group "Internal", then add yourself and any App Store Connect users. Enable build `1.0.0 (<n>)`. There is no review.

**On your phone** (TestFlight app, **Wi-Fi off**):
1. Sign up with a new email → you reach onboarding.
2. Connect a Sleeper team → Home loads today's schedule.
3. Allow notifications → Supabase Table Editor → `users` → your row has `expo_push_token` set.
4. Check production APNs with that token:
   ```bash
   curl -s https://exp.host/--/api/v2/push/send -H 'content-type: application/json' \
     -d '{"to":"<ExponentPushToken[…]>","title":"Pivot","body":"TestFlight push check"}'
   ```
   **Expect:** `{"data":{"status":"ok",…}}` and a banner on the phone.
5. Within 5 minutes, `fly logs -a pivot-sports-api --no-tail | grep lineup-sync-worker` → `synced 1 league(s), 0 failed.`

A build that fails step 1 or 2 is almost always a missing EAS value (§E), and fixing it only needs a new build (§F2). A build is not a backend deploy.

### G2. Thursday: external group and Beta App Review
Backend is frozen; everything here is App Store Connect.

1. **Check the icon first.** `app/app.json` has no `icon`, and there's no 1024×1024 marketing icon (B3 handoff blocker #3). Open the build in App Store Connect. If it shows a missing-icon issue, Beta App Review will reject it. Adding an icon means a design asset, `"icon"` in `app.json`, and a new build (§F2–F3), all before submitting for review.
2. TestFlight → External Testing → **+** → group "Beta" → add build `1.0.0 (<n>)`.
3. **Test Information:**
   - **Beta App Description:** "Pivot watches your fantasy lineup during live NFL games and tells you which game to switch to when one of your players is about to be on the field. Connect a Sleeper league, choose the streaming services you have, and Pivot sends a notification with a one-tap link to the right game."
   - **What to Test:** "Sign up, connect a Sleeper league (or add a team manually), pick your streaming services, and allow notifications. During live games (Thursday night, Sunday, Monday night) watch for switch notifications and try the Switch button."
   - **Feedback Email:** an inbox you actually read. `support@fantasyfocus.app` does not receive mail yet (Open Question #5).
   - **Privacy Policy URL:** App Store Connect may require one for external testing. `https://fantasyfocus.app/privacy` must actually load if you enter it (Open Question #5).
4. **Beta App Review Information:**
   - **Contact:** your name, phone, and email.
   - **Sign-in required:** yes. Create the reviewer account in Supabase → Authentication → Add user, with **Auto Confirm** and a strong password. Enter that email and password.
   - **Review notes:** "Email/password sign-in with the account above. League connect uses Sleeper: enter the public Sleeper username `<a username with a 2026 league>`, or tap 'Add manually' and type in a lineup. Game-day switch notifications only fire while NFL games are live (Thu 8:15pm ET, Sun 1pm–11:30pm ET, Mon 8:15pm ET). Outside those times the app shows the week's schedule."
5. **Submit for Review** on Thursday morning. A first build usually takes 24–48 hours, which lands before Sunday. After approval, add testers by email or a public link.
6. Your earlier plan: upgrade Supabase to **Pro** before outside testers join (`FLY-DEPLOY-CHECKLIST.md` "Later").

---

## Appendix: Upstash command estimate

This counts Redis commands only. Pub/sub deliveries to subscribers and `PING`/`AUTH` are not billed.

**Runner, idle (no live games), per day:**

| Source | Rate | Commands/day |
| --- | --- | --- |
| Dispatcher loop: lock `GET` + `ZRANGEBYSCORE flag_event_queue` before every 500 ms tick | ~4/s | ~345,600 |
| Lock heartbeat: renew `EVAL` every 5 s | 0.2/s | 17,280 |
| Discovery: lock `GET` every 30 s | | 2,880 |
| Airings cycle: lock `GET` + NFL-state `GET` (writes go to Postgres) | every 15 min Thu–Mon, daily otherwise | < 200 |
| **Runner idle total** | | **~366K** |

**Other processes:**
- **Worker, in season:** every 5 min, one NFL-state `GET`, plus per user a lineup `GET` and `SET` and ~12 stake `SADD`s. With 10 users that's ~150 commands per tick, ~44K/day.
- **API:** 2 `PSUBSCRIBE`s at boot; the idle-socket sweep is in memory. Weekday traffic is under 5K/day.

**Sunday, 14 games (~45 game-hours), 10 users.** Add to the idle baseline:

| Source | Commands/day |
| --- | --- |
| New plays (~2,800 across the slate). Each play costs ~15–25 commands: seen-set `SISMEMBER` + `SADD`, `game_state` `HGETALL` + `MULTI`/`HSET`/`EXPIRE`/`EXEC`, stake `SMEMBERS` ×2, per stake user lineup `GET` + flag `HGETALL`/`HSET` + `ZADD`, publish `HGETALL` + `PUBLISH` | ~40–70K |
| Discovery with live games (`game_state` `HGETALL` per live game per 30 s, stake check) | ~7K |
| Dispatcher deliveries (per due event: flag `HGETALL`, rate-limit `ZCOUNT` / `ZADD` + `EXPIRE`, `ZREM`) | ~3K |
| API: `ZADD active_users` on each 25 s pong (10 users × ~10 h) + REST reads | ~20K |

**Daily totals:**
- **Idle weekday:** ~0.41M/day.
- **Sunday:** ~0.49–0.51M/day.
- **Month (in season):** ~12.5–13.5M.

The heartbeat is about 4% of the idle total, so its interval was left at 5 s (TTL 15 s, three missed renews before loss). About 84% comes from the dispatcher loop's per-tick lock `GET` and queue read. That cost doesn't matter on the Fixed plan, so the runner code is unchanged.
