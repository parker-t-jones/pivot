# D1 — Deployment readiness runbook

**Status:** D1.1 config landed (2026-09-25). `Dockerfile`, `.dockerignore`, `fly.toml`, `GET /health`, `start:worker`, remote-safety seed guards, and EAS `environment` wiring are in the repo. **No** `fly deploy` **/ secrets yet** — Parker owns hosted steps.

**Sources:** `B3-HANDOFF.md`, `PIVOT-STAKES-PLAN.md` (Repo facts + §0), `PLAN.md` §6, `docs/B1-BROADCAST-DESIGN.md` §3.6, `docs/BROADCAST-DATA-RECON.md`, and a full `process.env` / config-loader grep.

**Guardrails (frozen):**


| Identifier                      | Value                                           | May change? |
| ------------------------------- | ----------------------------------------------- | ----------- |
| iOS bundle ID                   | `com.fantasyfocus.app`                          | **No**      |
| EAS slug / project              | `fantasy-focus` / `@parkertjones/fantasy-focus` | **No**      |
| Local Supabase CLI `project_id` | `FantasyFocusApp` (`supabase/config.toml`)      | **No**      |
| Production deploys              | Not on Thu / Sun / Mon during the NFL season    | **No**      |


Hosted Supabase gets its **own** project ref (e.g. `abcdefghijklmnop`). That is unrelated to `project_id = "FantasyFocusApp"`, which only names local Docker containers. Linking a remote project does **not** edit `config.toml`'s `project_id`.

---



## 1. Processes



### What exists today (long-running)


| Process                | Package / entry                             | Dev start                                       | Prod start                                                      | Role                                                                                                    |
| ---------------------- | ------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **API + WebSocket**    | `@pivot/api` → `services/api/src/index.ts`  | `pnpm --filter @pivot/api dev`                  | `node dist/index.js` (`pnpm --filter @pivot/api start`)         | REST + `GET /v1/realtime` WebSocket. Listens `0.0.0.0:$PORT` (default 3000).                            |
| **Lineup-sync worker** | `@pivot/api` → `services/api/src/worker.ts` | `pnpm --filter @pivot/api worker` (`tsx watch`) | `node dist/worker.js` (`pnpm --filter @pivot/api start:worker`) | Every 5 minutes: sync Sleeper lineups into cache + DB.                                                  |
| **Runner**             | `@pivot/api` → `services/api/src/runner.ts` | (no watch script)                               | `node dist/runner.js` (`pnpm --filter @pivot/api start:runner`) | Third process group: ESPN discovery, `games.status`, Redis `game_state`, flag dispatch. No public port. |


All three share the same image. They must **not** share an in-process memory cache: with separate processes, `CACHE_DRIVER=memory` gives each its own empty lineup / game-state store, and the runner never sees those lineups. Production sets `CACHE_DRIVER=redis` on the API, the worker, and the runner.

### Libraries that are not their own Fly process


| Library                 | Reality in repo                                                                                                                       | Hosting note                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Ingestion**           | `@pivot/ingestion` is a **library** (`EspnPlaySource`, etc.). Live path is the `runner` process, not a second app.                    | Process group `runner` on `pivot-sports-api` (`node dist/runner.js`). Do **not** invent a fourth Fly app for it. |
| **Engine + dispatcher** | Packages `@pivot/engine` / `@pivot/dispatcher` are libraries. The API uses dispatcher bits for Redis game-state + realtime subscribe. | The dispatch loop runs in the `runner` process. There is no `engine` process group.                              |




### Fly shape for v1 (recommendation)

**One Fly app, process groups** — see committed `fly.toml`:

```toml
[processes]
  api    = "node dist/index.js"
  worker = "node dist/worker.js"
  runner = "node dist/runner.js"
```


| Process  | Separate Fly app?       | Scale to zero?                                                                                                                                                                                                                                                                        |
| -------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api`    | No — `pivot-sports-api` | **Allowed** (`min_machines_running = 0` in `fly.toml`). Prefer `fly scale count -a pivot-sports-api api=1` for TestFlight if cold starts hurt.                                                                                                                                        |
| `worker` | No — `pivot-sports-api` | **Never.** After first deploy: `fly scale count -a pivot-sports-api worker=1`. `[[restart]] policy = always` keeps it up once scaled.                                                                                                                                                 |
| `runner` | No — `pivot-sports-api` | **Never.** After deploy: `fly scale count -a pivot-sports-api runner=1`. `shared-cpu-1x` @ 512MB. `[[restart]] policy = always` includes `runner`. Then `fly logs -a pivot-sports-api --process runner` should show `leader` and `discovery live=0` on a weekday, with no crash loop. |


Do **not** run API, worker, and runner as separate Fly apps. Shared secrets + one image.

### Runner (third process group)

`runner` is in `fly.toml`. It:

1. Owns concurrent `EspnPlaySource.subscribe()` loops (pattern from `experiments/live-sunday-harness.ts`).
2. Drives dispatcher scheduling / `watchForResumption` / silence ceiling / per-game collapse.
3. Does not yet run B1.7 broadcast airings. That sibling cycle waits on B1.6 — see `docs/B1-BROADCAST-DESIGN.md` §3.6. It is **not** a fourth process.

Deploy `api`, `worker`, and `runner`. Leave `PUSH_DRIVER` unset so this deploy does not send pushes.

---



## 2. Environment

Config loaders: `services/api/src/env.ts` (zod + dotenv), `services/ingestion/src/env.ts` (Sentry only; unused by a hosted process today), seed scripts reading `services/api/.env`, Expo `EXPO_PUBLIC_*` inlined at Metro/EAS build time.

### Runtime — API process


| Variable                    | Process             | Required?                     | Where value comes from                                      | Secret?  | Notes                                                                                                                                                         |
| --------------------------- | ------------------- | ----------------------------- | ----------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`              | API, worker, seeds  | **Required**                  | Hosted Supabase → Settings → API → Project URL              | No (URL) | Must be `https://<ref>.supabase.co`, not `127.0.0.1`.                                                                                                         |
| `SUPABASE_SERVICE_ROLE_KEY` | API, worker, seeds  | **Required**                  | Supabase → API → `service_role`                             | **Yes**  | Bypasses RLS. Never ship to the app.                                                                                                                          |
| `SUPABASE_JWT_SECRET`       | API                 | **Required** (zod)            | Supabase → Settings → API → JWT Secret (legacy)             | **Yes**  | HS256 fallback; ES256/RS256 verified via JWKS at `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`.                                                              |
| `CACHE_DRIVER`              | API, worker, runner | Required                      | Set explicitly                                              | No       | `redis` **on all three processes.** A memory cache cannot feed the runner.                                                                                    |
| `REDIS_URL`                 | API, worker, runner | Required in prod              | Upstash → Connect → TCP `rediss://…` (ioredis)              | **Yes**  | **Set this on all three processes.** Local Docker is `redis://127.0.0.1:6379`. Game state, lineup cache, the flag queue, and pub/sub use this ioredis client. |
| `UPSTASH_REDIS_REST_URL`    | API, worker         | Fallback if `REDIS_URL` unset | Upstash console                                             | **Yes**  | Not used when `REDIS_URL` is set. Do not point the REST client at the Docker port.                                                                            |
| `UPSTASH_REDIS_REST_TOKEN`  | API, worker         | Fallback if `REDIS_URL` unset | Upstash console                                             | **Yes**  |                                                                                                                                                               |
| `UPSTASH_REDIS_TCP_URL`     | API, runner         | Fallback if `REDIS_URL` unset | Upstash → Connect → `rediss://…`                            | **Yes**  | Subscribe fallback. Production should set `REDIS_URL` to this same TCP URL instead.                                                                           |
| `REVENUECAT_WEBHOOK_SECRET` | API                 | Optional until billing        | You generate; paste into RevenueCat webhook auth            | **Yes**  | Also read via raw `process.env` in `billing.ts` (not only through `env.ts`). Without it, `POST /billing/revenuecat` → 503.                                    |
| `PORT`                      | API                 | Optional (default 3000)       | Fly sets `PORT` / internal port                             | No       | Listen is already `0.0.0.0`.                                                                                                                                  |
| `GIT_SHA`                   | API (`GET /health`) | Optional (default `"dev"`)    | Docker `ARG` / `fly deploy -a pivot-sports-api --build-arg` | No       | Returned as `version` in `/health`.                                                                                                                           |
| `NODE_ENV`                  | API, worker, runner | Optional                      | `fly.toml` sets `production`                                | No       |                                                                                                                                                               |
| `PRODUCTION_REDIS_HOST`     | API, worker, runner | Set in prod                   | Upstash hostname only (no token)                            | No       | Not committed. If `NODE_ENV` is not `production` and a Redis URL's host matches, the process exits.                                                           |




### Runtime — worker process

Same Supabase vars as the API. The worker writes the lineup cache. In production it uses `REDIS_URL` (ioredis), the same TCP URL as the API and the runner, so a lineup written by the worker is visible to the runner. It does not open the realtime subscriber. The Upstash REST client is only the fallback when `REDIS_URL` is unset.

### Runtime — runner process

Same secrets as the worker, plus `PRODUCTION_REDIS_HOST`. `REDIS_URL` must be Upstash's **TCP** URL (`rediss://…` from Upstash → Connect → TCP) on the API, the worker, and the runner. Leave `PUSH_DRIVER` unset; it defaults to `none`.

### Client — Expo / EAS (`EXPO_PUBLIC_*`)


| Variable                         | Process | Required?          | Where value comes from                                | Secret?                          | Notes                                                   |
| -------------------------------- | ------- | ------------------ | ----------------------------------------------------- | -------------------------------- | ------------------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`       | App     | **Required**       | Same hosted Project URL                               | No                               | Baked into JS at build time.                            |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY`  | App     | **Required**       | Supabase → `anon` / publishable key                   | No (public by design; RLS-bound) |                                                         |
| `EXPO_PUBLIC_API_BASE_URL`       | App     | **Required**       | `https://pivot-sports-api.fly.dev` (no trailing path) | No                               | Drives REST + `wss://…/v1/realtime`.                    |
| `EXPO_PUBLIC_REVENUECAT_API_KEY` | App     | Optional until IAP | RevenueCat → iOS public SDK key                       | No (public SDK key)              | Without it, Upgrade UI opens but purchase/restore fail. |


`app/eas.json` maps `preview` → EAS environment `preview` and `production` → `production`. Set `EXPO_PUBLIC_*` in the Expo dashboard for those environments (no values in git).

### Documented in handoff / code comments but **not** in `services/api/src/env.ts` or `.env.example`


| Variable                                           | Who would read it                                           | Status                                                                                        | Secret?                           |
| -------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------- |
| `PUSH_DRIVER`                                      | Runner (`createPushNotifier` via `services/api/src/env.ts`) | **Leave unset** on Fly. Default is `none`. Values: `expo` | `none`.                           | No                                |
| Expo access token (constructor `expoAccessToken`)  | `ExpoPushNotifier` optional                                 | Not an env name in repo; Expo dashboard "Access Token" if rate-limited.                       | **Yes** if used                   |
| `SENTRY_DSN` / `SENTRY_ENVIRONMENT`                | `@pivot/ingestion` env only                                 | No hosted ingestion process yet. Optional later.                                              | DSN is **Yes**                    |
| `SEED_TEST_USER_EMAIL` / `SEED_TEST_USER_PASSWORD` | `scripts/seed-test-user.ts` only                            | Local/dev convenience. **Do not** seed a shared weak password into hosted unless intentional. | Password **Yes**                  |
| `PIVOT_EXPO_PUSH_TOKEN`                            | `experiments/live-sunday-harness.ts` only                   | Not for Fly.                                                                                  | Device token — treat as sensitive |
| `SUPABASE_ANON_KEY`                                | Root `.env.example` only                                    | **Unused by API/worker.** App uses `EXPO_PUBLIC_SUPABASE_ANON_KEY`.                           | No                                |




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
- Runtime `WORKDIR /app` with `dist/index.js` / `dist/worker.js` / `dist/runner.js`; `CMD` defaults to API. Fly process groups override the command.
- `.dockerignore` excludes `.env*`, `node_modules`, `app/`, `docs/`, `experiments/logs/`, `*.png`, `.git`.
- Optional build-arg: `GIT_SHA` → `/health` `version`.

**Verify:** `docker build -t pivot-sports-api .` then `curl localhost:<port>/health` → `200`.

---



## 4. Hosted Supabase



### 4.1 Create project **[Parker]**

1. [https://supabase.com/dashboard](https://supabase.com/dashboard) → New project.
2. **Region:** East US (North Virginia) / closest to Fly `iad` (Ashburn). Prefer the same metro as Fly to keep JWT/JWKS and PostgREST latency low.
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

**Verify:** Dashboard → Table Editor shows `users`, `teams`, `players`, `games`, `game_airings`, `leagues`, `lineup_slots`, `flag_events`, `viewing_sessions`, `user_app_presence`.  
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

**Broadcasts — `game_airings` from ESPN:**

- `pnpm seed:broadcasts` writes `game_airings` from an ESPN scoreboard (saved Week 3 JSON by default, `-- --live` for the current week; `docs/B1-BROADCAST-DESIGN.md` §6). It refuses any remote DB, so it is local-only.
- Hosted `game_airings` come from the runner's airings cycle (B1.6 / P0.13). Until the runner has run against hosted, `game_airings` is **empty** — Switch CTAs / deep links degrade; auth, leagues, Home schedule still work.
- The first hosted `game_airings` write happens on a Tue/Wed (deploy freeze, B1 §3.6).

**Optional:** `pnpm seed:test-user` — only if you want a known tester account; use a strong password on hosted.

### 4.5 Auth provider settings **[Parker]**

App auth today is **email + password only** (`signInWithPassword` / `signUp`). PLAN.md mentions Apple Sign In; it is **not** implemented — do not enable Apple in Supabase until the app ships it.

Hosted dashboard:


| Setting                        | Recommended for TestFlight                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Email provider                 | Enabled                                                                                                            |
| Confirm email                  | Match local: **off** (`enable_confirmations = false`) until SMTP + deep-link redirects are ready                   |
| Site URL                       | `pivot://` or a future `https://pivot-sports.app` — must match what the client uses for recovery links             |
| Redirect URLs                  | Add `pivot://**` / Expo auth callback URLs you actually use; local `http://127.0.0.1:3000` is irrelevant on hosted |
| Extra providers (Google/Apple) | Leave off                                                                                                          |


**Verify:** Dashboard → Authentication → Users → create/sign-in a test user; JWT from `POST /auth/v1/token?grant_type=password` validates against the API.

### 4.6 RLS checks **[Parker]**

Migrations enable RLS on user-owned and reference tables. Spot-check with the **anon** key (not service role):


| Expectation                                                                  | Check                                                    |
| ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| Anon cannot read another user's `leagues`                                    | Query with user A's JWT vs user B's row → empty / denied |
| Authenticated can `select` `teams` / `players` / `games` / `game_airings`    | Policies `*_select_authenticated`                        |
| Service role (API) bypasses RLS                                              | Lineup sync + seeds work                                 |


**Verify (example):** with anon key and no JWT, `from('users').select()` should not return rows; with user JWT, only `id = auth.uid()`.

### 4.7 Free tier vs paid (TestFlight)


|                      | Free                               | Pro (~$25/mo, PLAN.md) |
| -------------------- | ---------------------------------- | ---------------------- |
| DB size              | 500 MB                             | 8 GB+                  |
| Active projects      | 2                                  | more                   |
| **Inactivity pause** | **Yes — ~7 days low activity**     | **No auto-pause**      |
| Restore after pause  | Manual resume; long restore window | N/A                    |


**TestFlight verdict:** Free can work for a **small, active** tester group if the app or worker hits the DB regularly (lineup sync every 5 min from Fly worker counts as activity once deployed). Risk: if Fly worker is down and nobody opens the app for a week, Supabase **pauses** and every tester sees auth failures until you resume. For anything beyond a weekend spike, **Pro is the sane choice**. PLAN.md already budgets Pro.

---



## 5. Frozen identifiers (confirm)


| Claim                                                                                      | Confirmed?                                     |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `supabase/config.toml` `project_id = "FantasyFocusApp"` is the **local CLI / Docker name** | Yes                                            |
| Hosted project ref is independent                                                          | Yes — set only via `supabase link` / dashboard |
| Linking remote does not require renaming `project_id`                                      | Yes — **must not** rename                      |
| Bundle ID / EAS slug unchanged by backend deploy                                           | Yes                                            |


---



## 6. External dashboards



### 6.1 Sleeper — no OAuth redirect

Connect flow is **username → public Sleeper HTTP API** (`GET /sleeper/leagues?username=`), not OAuth. There is **no** Sleeper redirect URI to register for v1.

If a future OAuth product appears, it would be a new PLAN.md item — out of scope here.

### 6.2 RevenueCat webhook **[Parker]**


| Item        | Value                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| URL         | `https://pivot-sports-api.fly.dev/billing/revenuecat`                                                                        |
| Method      | `POST`                                                                                                                       |
| Auth        | `Authorization` header must equal `REVENUECAT_WEBHOOK_SECRET` (raw or `Bearer …`) — see `services/api/src/routes/billing.ts` |
| App user id | Supabase user UUID (`users.id`)                                                                                              |


**Verify:** RevenueCat "Send test event" → API logs + `users.subscription_tier` updates; wrong secret → `401`.

### 6.3 Push delivery (Expo → APNs)

**Path:** device registers an Expo push token → `POST /me/push-token` → (when a dispatcher process runs) `ExpoPushNotifier` → **Expo Push API** (`https://exp.host/--/api/v2/push/send`) → Apple APNs.

There is **no** raw APNs driver in this repo. Credentials:


| Credential                     | Where it lives                                                                      | Needed on Fly?                       | Status for `com.fantasyfocus.app`                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| Apple Push Key `82JW379P4C`    | **EAS / Expo project** `@parkertjones/fantasy-focus` (via `eas credentials -p ios`) | **No** — Expo’s servers talk to APNs | Verified on device (B1); same key covers development + production `aps-environment` |
| Expo push tokens               | `users.expo_push_token` in Supabase                                                 | N/A (data, not a secret file)        | Written by the app when permission granted                                          |
| Optional Expo **access token** | Expo dashboard → Access tokens; would be a Fly secret if rate limits require it     | Optional                             | Not configured in `env.ts` yet                                                      |
| `PUSH_DRIVER`                  | Runner, via `env.ts`                                                                | **No** — leave unset                 | Defaults to `none`. Do not set `expo` until after the weekday no-push check.        |


**Manual verify without P0:** curl Expo’s push API with a stored `ExponentPushToken[…]` (see `RUNBOOK.md` “PUSH NOTIFICATIONS ON DEVICE”). That proves APNs + EAS credentials independently of Fly.

**[Parker] push steps:**

1. Confirm `eas credentials -p ios` still shows Push Key `82JW379P4C` for this bundle ID.
2. After TestFlight build: re-verify one push (production APNs endpoint) via Expo curl or in-app once P0 lands.
3. Do **not** put the Apple `.p8` on Fly — Expo already holds it.



### 6.4 EAS `EXPO_PUBLIC_*` (dev vs production)


| Profile (`eas.json`) | EAS `environment`              | Where values live                                       |
| -------------------- | ------------------------------ | ------------------------------------------------------- |
| `development`        | (unset — local `.env` / Metro) | `app/.env` on laptop                                    |
| `preview`            | `preview`                      | Expo dashboard → Environment variables → **preview**    |
| `production`         | `production`                   | Expo dashboard → Environment variables → **production** |


Set at least: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_BASE_URL`, and optionally `EXPO_PUBLIC_REVENUECAT_API_KEY`. **Do not commit values.**

**Verify after EAS build:** on device, sign-in hits hosted Supabase (not `169.254.`* / `127.0.0.1`); Home REST calls succeed against Fly.

### 6.5 Upstash **[Parker]**

Create Redis (region near `iad`). On `pivot-sports-api`, set `REDIS_URL` to Upstash's TCP `rediss://` URL for the API, the worker, and the runner. REST URL and token stay as the fallback only, used when `REDIS_URL` is unset.

---



## 7. Fly specifics



### 7.1 App name

**Resolved (2026-09-27):** the app is `pivot-sports-api` (`https://pivot-sports-api.fly.dev`), created with `fly apps create pivot-sports-api` in Parker's personal org. It matches the `pivot-sports.app` domain used for support email.

`pivot-api` belongs to someone else. The `pivot-api.fly.dev` edge 404s noted in `docs/BROADCAST-DATA-RECON.md` came from that app, not ours, so it can never hold our secrets or hosted `SUPABASE_URL`.

### 7.2 Region, size, min machines


| Setting   | In `fly.toml` / after deploy                                                                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Region    | `iad`                                                                                                                                                                                                             |
| API VM    | `shared-cpu-1x` @ 512MB; `min_machines_running = 0` (may scale to zero)                                                                                                                                           |
| Worker VM | `shared-cpu-1x` @ 256MB; after deploy `fly scale count -a pivot-sports-api worker=1`                                                                                                                              |
| Runner VM | `shared-cpu-1x` @ 512MB; after deploy `fly scale count -a pivot-sports-api runner=1`, then `fly logs -a pivot-sports-api --process runner` shows `leader` and `discovery live=0` on a weekday, with no crash loop |
| HTTP      | `http_service` internal 3000, HTTPS, check `GET /health`. `processes = ['api']` — worker and runner have no public port.                                                                                          |




### 7.3 Health check

**Landed:** `GET /health` → `200 { "ok": true, "version": "<GIT_SHA|dev>" }`. No auth, no DB. Wired in `fly.toml` as `http_service.checks` path `/health`.

**Verify (once deployed):**

```bash
curl -sS https://pivot-sports-api.fly.dev/health
# expected: {"ok":true,"version":"..."}  and HTTP 200
```



### 7.4 Estimated monthly cost (TestFlight scale)

Rough, always-on, one region (pre–Oct 2026 Fly list prices; Oct 1 2026 bump ~+10%):


| Item                                                         | Estimate                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Fly API machine (`shared-cpu-1x` @ 512MB, may scale to zero) | ~$4–8/mo                                                                       |
| Fly worker (`shared-cpu-1x` @ 256MB, always on)              | ~$2–4/mo                                                                       |
| Fly runner (`shared-cpu-1x` @ 512MB, always on)              | ~$4–8/mo                                                                       |
| Fly bandwidth                                                | low for API JSON — a few $                                                     |
| Upstash Redis                                                | $0–10/mo (PLAN.md)                                                             |
| Supabase Free                                                | $0 (pause risk) or **Pro ~$25/mo**                                             |
| **Ballpark**                                                 | **~$15–40/mo** free Supabase + always-on Fly; **~$40–60/mo** with Supabase Pro |


PLAN.md's $20–50 Fly + $25 Supabase remains the planning band. EAS Production tier is separate (builds/push).

---



## 8. Order of operations

Do **not** deploy on Thu / Sun / Mon. Prefer Tue–Wed–Fri.


| #   | Owner                            | Step                                                                                                                                                                                                                                                           | Verify                                                                                | Expected                                                                                                                 |
| --- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | **[Parker]**                     | Create Fly account (done) + `fly auth login`                                                                                                                                                                                                                   | `fly auth whoami`                                                                     | Your email / org                                                                                                         |
| 2   | **[Parker]**                     | Create hosted Supabase (East / near `iad`); save URL + anon + service_role + JWT secret                                                                                                                                                                        | Dashboard project loads                                                               | Status healthy                                                                                                           |
| 3   | **[Parker]**                     | `supabase link --project-ref <ref>`                                                                                                                                                                                                                            | `cat supabase/.temp/project-ref`                                                      | Hosted ref; `config.toml` `project_id` still `FantasyFocusApp`                                                           |
| 4   | **[Parker]**                     | `supabase db push`                                                                                                                                                                                                                                             | Migration list / Table Editor                                                         | All 10 migrations present                                                                                                |
| 5   | **[Parker]**                     | Apply `supabase/seed.sql` (teams)                                                                                                                                                                                                                              | `select count(*) from teams`                                                          | `32`                                                                                                                     |
| 6   | **[Parker]**                     | Write `.env.production` (gitignored); `pnpm seed:players -- --env-file .env.production --allow-remote` and same for `seed:schedule`                                                                                                                            | Row counts / sample select                                                            | Players + games non-empty; guard message if flag omitted                                                                 |
| 7   | **[Parker]**                     | **Skip** `pnpm seed:broadcasts` (refused remotely even with `--allow-remote`)                                                                                                                                                                                  | N/A                                                                                   | No fixture OTA rows on hosted                                                                                            |
| 8   | **[Parker]**                     | Auth settings (email on, confirmations off for now); redirect URLs for `pivot://` if needed                                                                                                                                                                    | Sign-up in dashboard or curl token endpoint                                           | Access token returned                                                                                                    |
| 9   | **[Parker]**                     | Create Upstash Redis near `iad`; copy REST + TCP URLs                                                                                                                                                                                                          | Upstash ping / console                                                                | DB reachable                                                                                                             |
| 10  | **[Parker]**                     | Generate `REVENUECAT_WEBHOOK_SECRET`; note for Fly + RevenueCat                                                                                                                                                                                                | Stored in password manager                                                            | Non-empty random string                                                                                                  |
| 11  | **[Cursor]** ✓                   | `GET /health`, `start:worker`, Dockerfile, fly.toml, remote-safety, EAS environments                                                                                                                                                                           | `pnpm test`; `docker build`; `fly config validate`                                    | Green (D1.1)                                                                                                             |
| 12  | **[Parker]**                     | `fly apps create pivot-sports-api` (done 2026-09-27). `fly secrets set -a pivot-sports-api …` — runner secrets match the worker, plus `PRODUCTION_REDIS_HOST`. `REDIS_URL` is Upstash's TCP `rediss://` URL on all three processes. Leave `PUSH_DRIVER` unset. | `fly secrets list -a pivot-sports-api`                                                | Required keys present; **no** `.env` upload; `PUSH_DRIVER` absent                                                        |
| 13  | **[Parker]**                     | `fly deploy -a pivot-sports-api` on a non-frozen day (optionally `--build-arg GIT_SHA=$(git rev-parse --short HEAD)`)                                                                                                                                          | `fly status -a pivot-sports-api`; `curl https://pivot-sports-api.fly.dev/health`      | Machines started; health **200**                                                                                         |
| 14  | **[Parker]**                     | `fly scale count -a pivot-sports-api worker=1 runner=1` (and preferably `api=1` for TestFlight)                                                                                                                                                                | `fly scale show -a pivot-sports-api`; `fly logs -a pivot-sports-api --process runner` | `worker` and `runner` counts ≥ 1. On a weekday the runner logs `leader` and `discovery live=0`, and does not crash-loop. |
| 15  | **[Parker]**                     | Smoke API with JWT from hosted auth                                                                                                                                                                                                                            | `curl -H "Authorization: Bearer $JWT" https://pivot-sports-api.fly.dev/leagues`       | 200 JSON (likely `[]`)                                                                                                   |
| 16  | **[Parker]**                     | RevenueCat webhook URL + auth header → Fly                                                                                                                                                                                                                     | Test event in RC dashboard                                                            | 200 `{ ok: true, … }`                                                                                                    |
| 17  | **[Parker]**                     | Set Expo dashboard env vars for **preview** / **production** (`EXPO_PUBLIC_`*)                                                                                                                                                                                 | EAS build log shows injected env                                                      | No `127.0.0.1` / `169.254` in those builds                                                                               |
| 18  | **[Parker]**                     | Confirm APNs key still on EAS for `com.fantasyfocus.app`; optional Expo curl push smoke                                                                                                                                                                        | Notification on device                                                                | Ticket/receipt `ok`                                                                                                      |
| 19  | **[Parker]**                     | EAS build → TestFlight; sign in on a second device/network                                                                                                                                                                                                     | Auth + Home load                                                                      | Works off Parker's LAN                                                                                                   |
| 20  | **[Parker]** (later, a game day) | Runner is already the third process group. Watch one slate with `PUSH_DRIVER` still unset.                                                                                                                                                                     | `fly logs -a pivot-sports-api --process runner`; Home live list                       | `games.status` and the live list move. No push burst. Set `PUSH_DRIVER=expo` only after that check.                      |


---



## 9. Risks



### Secrets leakage


| Risk                                      | Mitigation                                                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `.env` copied into Docker image           | `.dockerignore` lists `.env*` / `**/.env*`. Verified empty `find` in image.                                                        |
| Seed scripts aimed at prod by accident    | `scripts/remoteSafety.ts` requires `--allow-remote`; fixture broadcasts refuse remote always. Prefer `--env-file .env.production`. |
| `SUPABASE_SERVICE_ROLE_KEY` in app bundle | Only `EXPO_PUBLIC_*` + anon key in the client.                                                                                     |
| `fly secrets` printed in CI logs          | Prefer `fly secrets set -a pivot-sports-api` locally; avoid echoing values in scripts.                                             |
| Committing linked project credentials     | `supabase/.temp/` is machine-local; do not force-add.                                                                              |




### Rollback blockers


| Blocker                             | Why it hurts                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| No readiness probe beyond `/health` | `/health` is liveness-only; a bad Redis secret still shows healthy.                                                       |
| Schema migrations are forward-only  | `db push` does not auto-write down migrations; bad migration ⇒ manual SQL fix.                                            |
| `EXPO_PUBLIC_*` baked into binary   | Rolling back Fly without a new EAS build leaves the app pointing at a dead URL if you change hostnames.                   |
| Redis + two processes               | Rolling back to `CACHE_DRIVER=memory` silently splits API/worker state.                                                   |
| Wrong app name                      | `pivot-api` is someone else's app. Always pass `-a pivot-sports-api` (or rely on `fly.toml`) so commands never target it. |




### Hard-coded `127.0.0.1` / [localhost](http://localhost)


| Location                                        | Production risk?                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| `app/.env` / `services/api/.env` (gitignored)   | **Yes if used for EAS** — must switch to hosted before production builds. |
| `app/.env.example`, `services/api/.env.example` | Docs only.                                                                |
| `supabase/config.toml` `api_url` / `site_url`   | Local stack only; hosted Auth settings are in the dashboard.              |
| Unit tests (`*.test.ts`)                        | No.                                                                       |
| **App / API TypeScript sources (non-test)**     | **No hard-coded loopback found** — URLs come from env.                    |


---



## 10. Artifacts


| Artifact                                                                                            | Status                                                                             |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `Dockerfile` / `.dockerignore`                                                                      | Done (D1.1)                                                                        |
| `fly.toml` (`iad`, `api`/`worker`/`runner`, `/health` check; API 512MB, worker 256MB, runner 512MB) | Done                                                                               |
| `GET /health` + `GIT_SHA` version                                                                   | Done (D1.1)                                                                        |
| `start:worker` and `start:runner` in `@pivot/api`                                                   | Done                                                                               |
| Remote-safety + `--env-file` for seeds                                                              | Done (D1.1)                                                                        |
| EAS `environment` for preview/production                                                            | Done (D1.1) — Parker fills dashboard values                                        |
| Upstash + Supabase + Fly + RevenueCat dashboard config                                              | **Parker**                                                                         |
| Runner process group; `PUSH_DRIVER` left unset (default `none`)                                     | In repo. Hosted `fly scale count -a pivot-sports-api runner=1` is Parker, Tue–Wed. |


---



## 11. Out of scope for this deploy (honest TestFlight)

- Live pushes. The `runner` process group is in the deploy, but `PUSH_DRIVER` stays unset (default `none`) until the weekday no-push check.
- Fixture or live `game_airings` until B1 seed path exists.
- Apple Sign In.
- Sleeper OAuth.
- App icon / App Store metadata (B3 blockers, separate).
- Domain `/terms` `/privacy` (still required before store review).

