# D1 — Deployment readiness runbook

**Status:** D1.1 config landed (2026-09-25). `Dockerfile`, `.dockerignore`, `fly.toml`, `GET /health`, `start:worker`, remote-safety seed guards, and EAS `environment` wiring are in the repo. **No `fly deploy` / secrets yet** — Parker owns hosted steps.

**Sources:** `B3-HANDOFF.md`, `PIVOT-STAKES-PLAN.md` (Repo facts + §0), `PLAN.md` §6, `docs/B1-BROADCAST-DESIGN.md` §3.6, `docs/BROADCAST-DATA-RECON.md`, and a full `process.env` / config-loader grep.

**Guardrails (frozen):**

| Identifier | Value | May change? |
|---|---|---|
| iOS bundle ID | `com.fantasyfocus.app` | **No** |
| EAS slug / project | `fantasy-focus` / `@parkertjones/fantasy-focus` | **No** |
| Local Supabase CLI `project_id` | `FantasyFocusApp` (`supabase/config.toml`) | **No** |
| Production deploys | Not on Thu / Sun / Mon during the NFL season | **No** |

Hosted Supabase gets its **own** project ref (e.g. `abcdefghijklmnop`). That is unrelated to `project_id = "FantasyFocusApp"`, which only names local Docker containers. Linking a remote project does **not** edit `config.toml`'s `project_id`.

---

## 1. Processes

### What exists today (long-running)

| Process | Package / entry | Dev start | Prod start | Role |
|---|---|---|---|---|
| **API + WebSocket** | `@pivot/api` → `services/api/src/index.ts` | `pnpm --filter @pivot/api dev` | `node dist/index.js` (`pnpm --filter @pivot/api start`) | REST + `GET /v1/realtime` WebSocket. Listens `0.0.0.0:$PORT` (default 3000). |
| **Lineup-sync worker** | `@pivot/api` → `services/api/src/worker.ts` | `pnpm --filter @pivot/api worker` (`tsx watch`) | `node dist/worker.js` (`pnpm --filter @pivot/api start:worker`) | Every 5 minutes: sync Sleeper lineups into cache + DB. |

Both share the same image and the same env. They must **not** share an in-process memory cache: with two processes, `CACHE_DRIVER=memory` gives each its own empty lineup / game-state store. Production requires `CACHE_DRIVER=redis` + Upstash.

### What PLAN.md §6 expects but is not a hosted process yet

| Planned process | Reality in repo | Hosting note |
|---|---|---|
| **Ingestion** | `@pivot/ingestion` is a **library** (`EspnPlaySource`, etc.). No `main` runner. Live path today is `experiments/live-sunday-harness.ts` / `experiments/live-ingest-service.ts`. | **P0** adds the production live-ingestion runner (one `EspnPlaySource` subscribe loop per live game). Slot: **third Fly process group** on the same app (preferred), or a sibling cycle on an expanded worker — P0 design decides. Do **not** invent a fourth Fly app for it. |
| **Engine + dispatcher** | Packages `@pivot/engine` / `@pivot/dispatcher` are libraries. The API uses dispatcher bits for Redis game-state + realtime subscribe. The dispatch **loop** (schedule → decide → push) only runs inside the harness today. | P0 folds this into the ingestion runner (or a dedicated `engine` process group). Until then, hosted API can serve REST/WS/auth/league connect; it cannot fire live "switch now" pushes from ESPN. |

### Fly shape for v1 (recommendation)

**One Fly app, process groups** — see committed `fly.toml`:

```toml
[processes]
  api    = "node dist/index.js"
  worker = "node dist/worker.js"
```

| Process | Separate Fly app? | Scale to zero? |
|---|---|---|
| `api` | No — same app | **Allowed** (`min_machines_running = 0` in `fly.toml`). Prefer `fly scale count api=1` for TestFlight if cold starts hurt. |
| `worker` | No — same app | **Never.** After first deploy: `fly scale count worker=1`. `[[restart]] policy = always` keeps it up once scaled. |
| P0 `ingest` (future) | No — same app | **Never.** Live poll loops cannot auto-stop. |

Do **not** run API and worker as two Fly apps unless secrets drift becomes painful; shared secrets + one image is simpler for v1.

### P0 slot (explicit)

When P0 lands, add a long-running process that:

1. Owns concurrent `EspnPlaySource.subscribe()` loops (pattern from `experiments/live-sunday-harness.ts`).
2. Drives dispatcher scheduling / `watchForResumption` / silence ceiling / per-game collapse.
3. Optionally runs B1.7 broadcast airings as a **sibling cycle** (15 min / daily) — see `docs/B1-BROADCAST-DESIGN.md` §3.6. That is **not** a fourth process if it rides the P0 runner.

Until P0: deploy **api + worker only**. Be honest with TestFlight testers: no live switch nudges from ESPN.

---

## 2. Environment

Config loaders: `services/api/src/env.ts` (zod + dotenv), `services/ingestion/src/env.ts` (Sentry only; unused by a hosted process today), seed scripts reading `services/api/.env`, Expo `EXPO_PUBLIC_*` inlined at Metro/EAS build time.

### Runtime — API process

| Variable | Process | Required? | Where value comes from | Secret? | Notes |
|---|---|---|---|---|---|
| `SUPABASE_URL` | API, worker, seeds | **Required** | Hosted Supabase → Settings → API → Project URL | No (URL) | Must be `https://<ref>.supabase.co`, not `127.0.0.1`. |
| `SUPABASE_SERVICE_ROLE_KEY` | API, worker, seeds | **Required** | Supabase → API → `service_role` | **Yes** | Bypasses RLS. Never ship to the app. |
| `SUPABASE_JWT_SECRET` | API | **Required** (zod) | Supabase → Settings → API → JWT Secret (legacy) | **Yes** | HS256 fallback; ES256/RS256 verified via JWKS at `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`. |
| `CACHE_DRIVER` | API, worker | Optional (default `memory`) | Set explicitly | No | Prod: **`redis`**. |
| `UPSTASH_REDIS_REST_URL` | API, worker | Required if redis | Upstash console | **Yes** | |
| `UPSTASH_REDIS_REST_TOKEN` | API, worker | Required if redis | Upstash console | **Yes** | |
| `UPSTASH_REDIS_TCP_URL` | API | Required if redis | Upstash → Connect → `rediss://…` (ioredis) | **Yes** | Needed for `/v1/realtime` `(P)SUBSCRIBE`. Worker lineup cache only needs REST. |
| `REVENUECAT_WEBHOOK_SECRET` | API | Optional until billing | You generate; paste into RevenueCat webhook auth | **Yes** | Also read via raw `process.env` in `billing.ts` (not only through `env.ts`). Without it, `POST /billing/revenuecat` → 503. |
| `PORT` | API | Optional (default 3000) | Fly sets `PORT` / internal port | No | Listen is already `0.0.0.0`. |
| `GIT_SHA` | API (`GET /health`) | Optional (default `"dev"`) | Docker `ARG` / `fly deploy --build-arg` | No | Returned as `version` in `/health`. |
| `NODE_ENV` | API / worker | Optional | `fly.toml` sets `production` | No | |

### Runtime — worker process

Same as API for Supabase + cache REST vars. Worker does **not** open the TCP realtime subscriber, but sharing one secrets set is fine.

### Client — Expo / EAS (`EXPO_PUBLIC_*`)

| Variable | Process | Required? | Where value comes from | Secret? | Notes |
|---|---|---|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | App | **Required** | Same hosted Project URL | No | Baked into JS at build time. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | App | **Required** | Supabase → `anon` / publishable key | No (public by design; RLS-bound) | |
| `EXPO_PUBLIC_API_BASE_URL` | App | **Required** | `https://<fly-app>.fly.dev` (no trailing path) | No | Drives REST + `wss://…/v1/realtime`. |
| `EXPO_PUBLIC_REVENUECAT_API_KEY` | App | Optional until IAP | RevenueCat → iOS public SDK key | No (public SDK key) | Without it, Upgrade UI opens but purchase/restore fail. |

`app/eas.json` maps `preview` → EAS environment `preview` and `production` → `production`. Set `EXPO_PUBLIC_*` in the Expo dashboard for those environments (no values in git).

### Documented in handoff / code comments but **not** in `services/api/src/env.ts` or `.env.example`

| Variable | Who would read it | Status | Secret? |
|---|---|---|---|
| `PUSH_DRIVER` | Intended for P0 / harness (`createPushNotifier`); **no production process loads it today** | Flagged: B3-HANDOFF lists it for prod; API `env.ts` does not. Add to env schema when P0 wires push. Values: `expo` \| `none`. | No |
| Expo access token (constructor `expoAccessToken`) | `ExpoPushNotifier` optional | Not an env name in repo; Expo dashboard "Access Token" if rate-limited. | **Yes** if used |
| `SENTRY_DSN` / `SENTRY_ENVIRONMENT` | `@pivot/ingestion` env only | No hosted ingestion process yet. Optional later. | DSN is **Yes** |
| `SEED_TEST_USER_EMAIL` / `SEED_TEST_USER_PASSWORD` | `scripts/seed-test-user.ts` only | Local/dev convenience. **Do not** seed a shared weak password into hosted unless intentional. | Password **Yes** |
| `PIVOT_EXPO_PUSH_TOKEN` | `experiments/live-sunday-harness.ts` only | Not for Fly. | Device token — treat as sensitive |
| `SUPABASE_ANON_KEY` | Root `.env.example` only | **Unused by API/worker.** App uses `EXPO_PUBLIC_SUPABASE_ANON_KEY`. | No |

### Seed / one-off scripts (laptop → hosted DB)

Use a **gitignored** `.env.production` (never commit it) plus the remote-safety flags:

```bash
pnpm seed:players -- --env-file .env.production --allow-remote
pnpm seed:schedule -- --env-file .env.production --allow-remote
# Do NOT run pnpm seed:broadcasts against hosted — refused even with --allow-remote
```

Scripts under `scripts/` that write to the DB call `bootstrapSeedScript` (`scripts/remoteSafety.ts`). Localhost/`127.0.0.1` is unrestricted; any other `SUPABASE_URL` exits non-zero unless `--allow-remote` is passed. Fixture broadcast seeders always refuse remote.

---

## 3. Container

**Landed in repo:** `Dockerfile`, `.dockerignore`, `fly.toml`.

- Multi-stage Node **22** build; `pnpm@9.15.0` via Corepack.
- Build: `tsc -b tsconfig.build.json`, then `pnpm --filter=@pivot/api deploy --prod /out`.
- Runtime `WORKDIR /app` with `dist/index.js` / `dist/worker.js`; `CMD` defaults to API.
- `.dockerignore` excludes `.env*`, `node_modules`, `app/`, `docs/`, `experiments/logs/`, `*.png`, `.git`.
- Optional build-arg: `GIT_SHA` → `/health` `version`.

**Verify:** `docker build -t pivot-api .` then `curl localhost:<port>/health` → `200`.

---

## 4. Hosted Supabase

### 4.1 Create project **[Parker]**

1. https://supabase.com/dashboard → New project.
2. **Region:** East US (North Virginia) / closest to Fly **`iad`** (Ashburn). Prefer the same metro as Fly to keep JWT/JWKS and PostgREST latency low.
3. Save: Project URL, `anon` key, `service_role` key, JWT secret.
4. Free vs Pro: see §4.6.

### 4.2 Link CLI **[Parker]** (from laptop)

```bash
cd /Users/parkerjones/Developer/projects/pivot
npx supabase login
npx supabase link --project-ref <HOSTED_REF>
```

**Verify:** `supabase/.temp/project-ref` contains `<HOSTED_REF>`.  
**Confirm:** `supabase/config.toml` still has `project_id = "FantasyFocusApp"` unchanged.

### 4.3 Apply migrations (in order) **[Parker]**

Migrations (already timestamp-ordered):

1. `20260510120000_users_user_app_presence.sql`
2. `20260510120100_nfl_reference_entities.sql`
3. `20260709220000_leagues_lineup_slots.sql`
4. `20260712160000_flag_events.sql`
5. `20260712230000_viewing_sessions.sql`
6. `20260801170000_leagues_external_unique.sql`
7. `20260803010000_games_season_type.sql`
8. `20260815200000_leagues_lineup_source_fallback.sql`
9. `20260816010000_search_players.sql`
10. `20260918120000_streaming_services_vmvpds.sql`

```bash
npx supabase db push
```

**Verify:** Dashboard → Table Editor shows `users`, `teams`, `players`, `games`, `game_broadcasts`, `leagues`, `lineup_slots`, `flag_events`, `viewing_sessions`, `user_app_presence`.  
Or: `npx supabase migration list` shows remote = local.

### 4.4 Seed (hosted) **[Parker]**

`db push` does **not** run `supabase/seed.sql`. Local `supabase db reset` does; hosted must apply seed explicitly.

**Required:**

1. **Teams** from `supabase/seed.sql` (32 NFL teams). Without this, `pnpm seed:players` fails ("No teams found").

   ```bash
   # Example: SQL editor paste, or:
   npx supabase db execute --file supabase/seed.sql --linked
   ```

   **Verify:** `select count(*) from teams;` → `32`.

2. Create gitignored `.env.production` with hosted `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, then:

   ```bash
   pnpm seed:players -- --env-file .env.production --allow-remote
   pnpm seed:schedule -- --env-file .env.production --allow-remote
   ```

   **Verify:**

   ```bash
   # players non-empty; games for current season present
   # After API is up: GET /state/nfl returns non-null openers when schedule seeded
   ```

**Broadcasts — B1 seed only; no fixture rotation:**

- Current `pnpm seed:broadcasts` writes the **OTA fixture rotation** (`fox`/`cbs`/… + synthetic `sunday_ticket` / `nfl_plus`). **Do not run it against hosted.**
- B1 (`docs/B1-BROADCAST-DESIGN.md` §6) replaces that with ESPN scoreboard → `game_airings` (or network-only `game_broadcasts` as a temporary compat dump). Until B1.2/B1.6 land, hosted may have **empty** `game_broadcasts` — Switch CTAs / deep links degrade; auth, leagues, Home schedule still work.
- When B1 seed exists: run **`pnpm seed:broadcasts --live`** (or the saved-scoreboard path), never the old `OTA_ROTATION` path, and only on a Tue/Wed (deploy freeze).

**Optional:** `pnpm seed:test-user` — only if you want a known tester account; use a strong password on hosted.

### 4.5 Auth provider settings **[Parker]**

App auth today is **email + password only** (`signInWithPassword` / `signUp`). PLAN.md mentions Apple Sign In; it is **not** implemented — do not enable Apple in Supabase until the app ships it.

Hosted dashboard:

| Setting | Recommended for TestFlight |
|---|---|
| Email provider | Enabled |
| Confirm email | Match local: **off** (`enable_confirmations = false`) until SMTP + deep-link redirects are ready |
| Site URL | `pivot://` or a future `https://pivot-sports.app` — must match what the client uses for recovery links |
| Redirect URLs | Add `pivot://**` / Expo auth callback URLs you actually use; local `http://127.0.0.1:3000` is irrelevant on hosted |
| Extra providers (Google/Apple) | Leave off |

**Verify:** Dashboard → Authentication → Users → create/sign-in a test user; JWT from `POST /auth/v1/token?grant_type=password` validates against the API.

### 4.6 RLS checks **[Parker]**

Migrations enable RLS on user-owned and reference tables. Spot-check with the **anon** key (not service role):

| Expectation | Check |
|---|---|
| Anon cannot read another user's `leagues` | Query with user A's JWT vs user B's row → empty / denied |
| Authenticated can `select` `teams` / `players` / `games` / `game_broadcasts` | Policies `*_select_authenticated` |
| Service role (API) bypasses RLS | Lineup sync + seeds work |

**Verify (example):** with anon key and no JWT, `from('users').select()` should not return rows; with user JWT, only `id = auth.uid()`.

### 4.7 Free tier vs paid (TestFlight)

| | Free | Pro (~$25/mo, PLAN.md) |
|---|---|---|
| DB size | 500 MB | 8 GB+ |
| Active projects | 2 | more |
| **Inactivity pause** | **Yes — ~7 days low activity** | **No auto-pause** |
| Restore after pause | Manual resume; long restore window | N/A |

**TestFlight verdict:** Free can work for a **small, active** tester group if the app or worker hits the DB regularly (lineup sync every 5 min from Fly worker counts as activity once deployed). Risk: if Fly worker is down and nobody opens the app for a week, Supabase **pauses** and every tester sees auth failures until you resume. For anything beyond a weekend spike, **Pro is the sane choice**. PLAN.md already budgets Pro.

---

## 5. Frozen identifiers (confirm)

| Claim | Confirmed? |
|---|---|
| `supabase/config.toml` `project_id = "FantasyFocusApp"` is the **local CLI / Docker name** | Yes |
| Hosted project ref is independent | Yes — set only via `supabase link` / dashboard |
| Linking remote does not require renaming `project_id` | Yes — **must not** rename |
| Bundle ID / EAS slug unchanged by backend deploy | Yes |

---

## 6. External dashboards

### 6.1 Sleeper — no OAuth redirect

Connect flow is **username → public Sleeper HTTP API** (`GET /sleeper/leagues?username=`), not OAuth. There is **no** Sleeper redirect URI to register for v1.

If a future OAuth product appears, it would be a new PLAN.md item — out of scope here.

### 6.2 RevenueCat webhook **[Parker]**

| Item | Value |
|---|---|
| URL | `https://<fly-app>.fly.dev/billing/revenuecat` |
| Method | `POST` |
| Auth | `Authorization` header must equal `REVENUECAT_WEBHOOK_SECRET` (raw or `Bearer …`) — see `services/api/src/routes/billing.ts` |
| App user id | Supabase user UUID (`users.id`) |

**Verify:** RevenueCat "Send test event" → API logs + `users.subscription_tier` updates; wrong secret → `401`.

### 6.3 Push delivery (Expo → APNs)

**Path:** device registers an Expo push token → `POST /me/push-token` → (when a dispatcher process runs) `ExpoPushNotifier` → **Expo Push API** (`https://exp.host/--/api/v2/push/send`) → Apple APNs.

There is **no** raw APNs driver in this repo. Credentials:

| Credential | Where it lives | Needed on Fly? | Status for `com.fantasyfocus.app` |
|---|---|---|---|
| Apple Push Key `82JW379P4C` | **EAS / Expo project** `@parkertjones/fantasy-focus` (via `eas credentials -p ios`) | **No** — Expo’s servers talk to APNs | Verified on device (B1); same key covers development + production `aps-environment` |
| Expo push tokens | `users.expo_push_token` in Supabase | N/A (data, not a secret file) | Written by the app when permission granted |
| Optional Expo **access token** | Expo dashboard → Access tokens; would be a Fly secret if rate limits require it | Optional | Not configured in `env.ts` yet |
| `PUSH_DRIVER=expo` | Would be a Fly secret/env when P0 wires the dispatcher runner | Yes (then) | **Not loaded by API/worker today** — live pushes wait on P0 |

**Manual verify without P0:** curl Expo’s push API with a stored `ExponentPushToken[…]` (see `RUNBOOK.md` “PUSH NOTIFICATIONS ON DEVICE”). That proves APNs + EAS credentials independently of Fly.

**[Parker] push steps:**

1. Confirm `eas credentials -p ios` still shows Push Key `82JW379P4C` for this bundle ID.
2. After TestFlight build: re-verify one push (production APNs endpoint) via Expo curl or in-app once P0 lands.
3. Do **not** put the Apple `.p8` on Fly — Expo already holds it.

### 6.4 EAS `EXPO_PUBLIC_*` (dev vs production)

| Profile (`eas.json`) | EAS `environment` | Where values live |
|---|---|---|
| `development` | (unset — local `.env` / Metro) | `app/.env` on laptop |
| `preview` | `preview` | Expo dashboard → Environment variables → **preview** |
| `production` | `production` | Expo dashboard → Environment variables → **production** |

Set at least: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_BASE_URL`, and optionally `EXPO_PUBLIC_REVENUECAT_API_KEY`. **Do not commit values.**

**Verify after EAS build:** on device, sign-in hits hosted Supabase (not `169.254.*` / `127.0.0.1`); Home REST calls succeed against Fly.

### 6.5 Upstash **[Parker]**

Create Redis (region near `iad`), copy REST URL/token + TCP `rediss://` URL into Fly secrets.

---

## 7. Fly specifics

### 7.1 App name

`pivot-api.fly.dev` already **resolves** (recon 2026-09-24) and returned edge `404 NOT_FOUND` — may be an empty/foreign reservation. After `fly auth login`:

```bash
fly apps list
fly status -a pivot-api   # if listed
```

If `pivot-api` is yours and empty, reuse it. If taken or unclear, alternatives:

| Candidate | Notes |
|---|---|
| `pivot-sports-api` | Matches `support@pivot-sports.app` branding |
| `pivot-backend` | Clear |
| `fantasyfocus-api` | Matches frozen bundle naming; uglier product name |

### 7.2 Region, size, min machines

| Setting | In `fly.toml` / after deploy |
|---|---|
| Region | **`iad`** |
| API VM | `shared-cpu-1x` @ 512MB; `min_machines_running = 0` (may scale to zero) |
| Worker VM | `shared-cpu-1x` @ 256MB; after deploy **`fly scale count worker=1`** |
| HTTP | `http_service` internal 3000, HTTPS, check `GET /health` |

### 7.3 Health check

**Landed:** `GET /health` → `200 { "ok": true, "version": "<GIT_SHA|dev>" }`. No auth, no DB. Wired in `fly.toml` as `http_service.checks` path `/health`.

**Verify (once deployed):**

```bash
curl -sS https://<fly-app>.fly.dev/health
# expected: {"ok":true,"version":"..."}  and HTTP 200
```

### 7.4 Estimated monthly cost (TestFlight scale)

Rough, always-on, one region (pre–Oct 2026 Fly list prices; Oct 1 2026 bump ~+10%):

| Item | Estimate |
|---|---|
| Fly API machine (shared-1x 1GB, always on) | ~$8–16/mo |
| Fly worker (shared-1x 512MB, always on) | ~$4–8/mo |
| Fly bandwidth | low for API JSON — a few $ |
| Upstash Redis | $0–10/mo (PLAN.md) |
| Supabase Free | $0 (pause risk) or **Pro ~$25/mo** |
| **Ballpark** | **~$15–40/mo** free Supabase + always-on Fly; **~$40–60/mo** with Supabase Pro |

PLAN.md's $20–50 Fly + $25 Supabase remains the planning band. EAS Production tier is separate (builds/push).

---

## 8. Order of operations

Do **not** deploy on Thu / Sun / Mon. Prefer Tue–Wed–Fri.

| # | Owner | Step | Verify | Expected |
|---|---|---|---|---|
| 1 | **[Parker]** | Create Fly account (done) + `fly auth login` | `fly auth whoami` | Your email / org |
| 2 | **[Parker]** | Create hosted Supabase (East / near `iad`); save URL + anon + service_role + JWT secret | Dashboard project loads | Status healthy |
| 3 | **[Parker]** | `supabase link --project-ref <ref>` | `cat supabase/.temp/project-ref` | Hosted ref; `config.toml` `project_id` still `FantasyFocusApp` |
| 4 | **[Parker]** | `supabase db push` | Migration list / Table Editor | All 10 migrations present |
| 5 | **[Parker]** | Apply `supabase/seed.sql` (teams) | `select count(*) from teams` | `32` |
| 6 | **[Parker]** | Write `.env.production` (gitignored); `pnpm seed:players -- --env-file .env.production --allow-remote` and same for `seed:schedule` | Row counts / sample select | Players + games non-empty; guard message if flag omitted |
| 7 | **[Parker]** | **Skip** `pnpm seed:broadcasts` (refused remotely even with `--allow-remote`) | N/A | No fixture OTA rows on hosted |
| 8 | **[Parker]** | Auth settings (email on, confirmations off for now); redirect URLs for `pivot://` if needed | Sign-up in dashboard or curl token endpoint | Access token returned |
| 9 | **[Parker]** | Create Upstash Redis near `iad`; copy REST + TCP URLs | Upstash ping / console | DB reachable |
| 10 | **[Parker]** | Generate `REVENUECAT_WEBHOOK_SECRET`; note for Fly + RevenueCat | Stored in password manager | Non-empty random string |
| 11 | **[Cursor]** ✓ | `GET /health`, `start:worker`, Dockerfile, fly.toml, remote-safety, EAS environments | `pnpm test`; `docker build`; `fly config validate` | Green (D1.1) |
| 12 | **[Parker]** | `fly apps create pivot-api` (or rename in `fly.toml` if taken); `fly secrets set …` | `fly secrets list -a pivot-api` | Required keys present; **no** `.env` upload |
| 13 | **[Parker]** | `fly deploy` on a non-frozen day (optionally `--build-arg GIT_SHA=$(git rev-parse --short HEAD)`) | `fly status`; `curl https://pivot-api.fly.dev/health` | Machines started; health **200** |
| 14 | **[Parker]** | `fly scale count worker=1` (and preferably `api=1` for TestFlight) | `fly scale show` | `worker` count ≥ 1 |
| 15 | **[Parker]** | Smoke API with JWT from hosted auth | `curl -H "Authorization: Bearer $JWT" https://pivot-api.fly.dev/leagues` | 200 JSON (likely `[]`) |
| 16 | **[Parker]** | RevenueCat webhook URL + auth header → Fly | Test event in RC dashboard | 200 `{ ok: true, … }` |
| 17 | **[Parker]** | Set Expo dashboard env vars for **preview** / **production** (`EXPO_PUBLIC_*`) | EAS build log shows injected env | No `127.0.0.1` / `169.254` in those builds |
| 18 | **[Parker]** | Confirm APNs key still on EAS for `com.fantasyfocus.app`; optional Expo curl push smoke | Notification on device | Ticket/receipt `ok` |
| 19 | **[Parker]** | EAS build → TestFlight; sign in on a second device/network | Auth + Home load | Works off Parker's LAN |
| 20 | **[Cursor]** (later) | P0 ingestion runner + `PUSH_DRIVER` in `env.ts` | Weekday live test | Live games update state; pushes only after intentional enable |

---

## 9. Risks

### Secrets leakage

| Risk | Mitigation |
|---|---|
| `.env` copied into Docker image | `.dockerignore` lists `.env*` / `**/.env*`. Verified empty `find` in image. |
| Seed scripts aimed at prod by accident | `scripts/remoteSafety.ts` requires `--allow-remote`; fixture broadcasts refuse remote always. Prefer `--env-file .env.production`. |
| `SUPABASE_SERVICE_ROLE_KEY` in app bundle | Only `EXPO_PUBLIC_*` + anon key in the client. |
| `fly secrets` printed in CI logs | Prefer `fly secrets set` locally; avoid echoing values in scripts. |
| Committing linked project credentials | `supabase/.temp/` is machine-local; do not force-add. |

### Rollback blockers

| Blocker | Why it hurts |
|---|---|
| No readiness probe beyond `/health` | `/health` is liveness-only; a bad Redis secret still shows healthy. |
| Schema migrations are forward-only | `db push` does not auto-write down migrations; bad migration ⇒ manual SQL fix. |
| `EXPO_PUBLIC_*` baked into binary | Rolling back Fly without a new EAS build leaves the app pointing at a dead URL if you change hostnames. |
| Redis + two processes | Rolling back to `CACHE_DRIVER=memory` silently splits API/worker state. |
| Empty `pivot-api` DNS mystery | Deploying to the wrong org's app name fails or hijacks expectations — confirm ownership first. |

### Hard-coded `127.0.0.1` / localhost

| Location | Production risk? |
|---|---|
| `app/.env` / `services/api/.env` (gitignored) | **Yes if used for EAS** — must switch to hosted before production builds. |
| `app/.env.example`, `services/api/.env.example` | Docs only. |
| `supabase/config.toml` `api_url` / `site_url` | Local stack only; hosted Auth settings are in the dashboard. |
| Unit tests (`*.test.ts`) | No. |
| **App / API TypeScript sources (non-test)** | **No hard-coded loopback found** — URLs come from env. |

---

## 10. Artifacts

| Artifact | Status |
|---|---|
| `Dockerfile` / `.dockerignore` | Done (D1.1) |
| `fly.toml` (`iad`, `api`/`worker`, `/health` check) | Done (D1.1) |
| `GET /health` + `GIT_SHA` version | Done (D1.1) |
| `start:worker` in `@pivot/api` | Done (D1.1) |
| Remote-safety + `--env-file` for seeds | Done (D1.1) |
| EAS `environment` for preview/production | Done (D1.1) — Parker fills dashboard values |
| Upstash + Supabase + Fly + RevenueCat dashboard config | **Parker** |
| P0 ingest process + `PUSH_DRIVER` in `env.ts` | Later phase |

---

## 11. Out of scope for this deploy (honest TestFlight)

- Live ESPN → notification loop (P0).
- Fixture or live `game_broadcasts` / `game_airings` until B1 seed path exists.
- Apple Sign In.
- Sleeper OAuth.
- App icon / App Store metadata (B3 blockers, separate).
- Domain `/terms` `/privacy` (still required before store review).
