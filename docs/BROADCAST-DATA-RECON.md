# Broadcast Data Recon

Read-only recon of where production `game_broadcasts` data comes from, how
routing consumes it, and what ESPN actually returns for Week 3 (2026). No code
changes in this pass beyond saving the ESPN response under `experiments/logs/`.

Date: 2026-09-24.

---

## 1. Has `scripts/seed-broadcasts.ts` ever run against production Supabase?

**No evidence of a production Supabase project at all, let alone a seed run
against one.**

| Check | Finding |
|---|---|
| CI | No `.github/` workflows. Nothing automates `pnpm seed:broadcasts`. |
| Deploy | No `fly.toml`, no Dockerfile, no linked remote (`supabase/.temp/project-ref` absent). |
| `B3-HANDOFF.md` (Aug 21 2026) | Explicit: "There is no deployed backend. At all." Supabase is local-only; `seed:broadcasts` is listed as a step still needed *if* a hosted project is created. |
| Seed script | Reads `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` from `services/api/.env`. That file currently points at `127.0.0.1` (local Kong). |
| Migrations | Create `game_broadcasts` and expand the service CHECK; none INSERT rows. |
| One-off | `scripts/tmp-seed-broadcasts-chunked.ts` is a local-only workaround for a URI-too-long DELETE against the *dev* Kong stack — same env, same fixture rows. |

So the only place seed has been shown to write is the local stack.

### Can production rows be told apart from seeded rows?

**Not by schema.** `game_broadcasts` columns are only:

`id`, `game_id`, `service`, `deep_link_url`, `requires_subscription`

No `source`, `seeded_at`, or `espn_event_id`.

**Heuristically, yes.** Seeded rows from `buildBroadcastRows` are a rigid
pattern: one rotating OTA (`fox`/`cbs`/`nbc`/`abc` by game index) +
`sunday_ticket` + `nfl_plus`, with deep links from `BROADCAST_TEMPLATES`
(e.g. `https://tv.youtube.com/live`, `https://www.nfl.com/scores`). Real ESPN
airings (Prime Video on TNF, ESPN+ABC on MNF) never appear in that rotation.

---

## 2. Does any production code path write `game_broadcasts` from ESPN?

**No.**

- `services/ingestion` polls ESPN scoreboard/summary for *plays* only.
  `espnScoreboardEventSchema` (`espnTypes.ts`) does not include
  `competitions[].broadcasts` or `geoBroadcasts`.
- Grep of `services/` for inserts into `game_broadcasts` finds only the seed
  scripts (and tests / in-memory catalogs). API routes **read** the table
  (`GET /games?week=`, `GET /games/:id/broadcasts`); they never write it.
- Dispatcher `InMemoryBroadcastCatalog` is harness/test wiring, not a DB writer.

### What does the routing path read for a real game?

```
game_broadcasts rows
  → GET /games/:id/broadcasts (or /games?week=)
  → rankBroadcasts(broadcasts, user_app_presence)
  → preferred.deep_link_url → openBroadcast / Switch CTA
```

Same table for dispatcher enrichment (`recommended_source` / deep link). If the
rows are seed fixtures, routing ranks and deep-links the *fixture* services —
not ESPN's actual airing network. Example from local Week 3: TNF ATL@GB is
seeded as `cbs` (+ carriers); ESPN says **Prime Video**.

---

## 3. ESPN scoreboard sample (Week 3, 2026)

Saved at:

- `experiments/logs/espn-scoreboard-2026-week3.json`
- `experiments/logs/espn-scoreboard-20260924.json` (default endpoint; same week)

Request: `GET https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=3`

| Window | Game | `broadcasts` | `geoBroadcasts` (type / market / media) |
|---|---|---|---|
| TNF | ATL @ GB | names: `["Prime Video"]`, market: `national` | Streaming / National / Prime Video |
| Sunday early | LAC @ BUF | names: `["FOX"]`, market: `national` | TV / National / FOX |
| SNF | LAR @ DEN | names: `["NBC"]`, market: `national` | TV / National / NBC |
| MNF | PHI @ CHI | names: `["ESPN","ABC"]`, market: `national` | TV / National / ESPN **and** TV / National / ABC (simulcast) |

Notes from the same payload: most Sunday 1pm/4pm games are listed as a single
national OTA name (FOX or CBS). Local-market-only entries did not appear on
this national scoreboard response for Week 3.

---

## 4. What would have to change for ESPN / ABC+ESPN simulcasts
(list only — no implementation)

For a real airing-network key on MNF (and ABC/ESPN simulcasts):

1. **DB catalog** — Extend `is_valid_streaming_service` (migration) with an
   `espn` key (linear ESPN, distinct from existing `espn_plus`).
2. **`STREAMING_SERVICES`** — Add `espn` in every hand-maintained copy:
   `app/lib/streamingServices.ts`, `services/api/src/routes/me.ts`, and any
   other enum mirrors / CHECK consumers.
3. **Labels / Settings** — `SERVICE_LABELS` in `gameDisplay.ts`,
   `STREAMING_SERVICE_INFO` (label + App Store search), onboarding/Settings
   multi-select copy.
4. **`networkLabel` / `asNetwork`** — Map `espn` to a board abbreviation (e.g.
   `ESPN`) with an explicit rank among OTA/streaming exclusives; decide
   simulcast precedence when both `espn` and `abc` are present (board shows
   one label today).
5. **Ingestion mapping** — Parse ESPN `competitions[].broadcasts` /
   `geoBroadcasts` on scoreboard (and/or schedule ingest); map media shortNames
   (`ESPN`, `ABC`, `Prime Video`, `NBC`, …) → catalog keys; write/upsert
   `game_broadcasts` instead of (or after retiring) `seed-broadcasts` rotation.
6. **Seed / fixtures** — Stop assigning a rotating OTA to night games; either
   delete seed for those windows or seed from the same ESPN mapping used in
   prod so local boards match reality.
7. **Deep links / lag** — `BROADCAST_TEMPLATES` (or successor) entry for `espn`;
   `BROADCAST_LAG_SECONDS` / dispatcher lag table if ESPN linear differs from
   `espn_plus` / ABC.
8. **Tests** — Seed builder tests, `networkLabel` / board tests, API
   `rankBroadcasts` fixtures, and any CHECK-constraint tests that enumerate
   the enum.

Stop.
