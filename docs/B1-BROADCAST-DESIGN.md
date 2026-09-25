# B1 — Broadcast data design

Replace seeded `game_broadcasts` with ESPN-sourced airings, joined at read time
to a versioned carriage map. Routing answers two different questions that today
share one enum.

**This is a design pass.** No code, no migrations, no edits outside this file.
Where live data is required, this doc specifies an `experiments/` probe rather
than guessing.

Date: 2026-09-24 (decisions recorded 2026-09-25).
Depends on: `docs/BROADCAST-DATA-RECON.md`, `PIVOT-STAKES-PLAN.md` Repo facts
and §0, `experiments/logs/espn-scoreboard-2026-week3.json`.

**§9 decisions are locked.** Implementation may start at B1.1. Do not re-open
the questions below without an explicit plan change.

---

## 0. The mix-up

`STREAMING_SERVICES` (copied by hand in `app/lib/streamingServices.ts` and
`services/api/src/routes/me.ts`) is one list that holds two kinds of thing:

| Kind | Keys today | What they actually are |
|---|---|---|
| **Airing networks** | `cbs`, `fox`, `nbc`, `abc`, plus `amazon_prime`, `peacock`, `nfl_network` when they hold the window | Who is transmitting the game |
| **Paid services** | `sunday_ticket`, `hulu`, `fubo`, `directv`, `espn_plus`, `paramount_plus`, `nfl_plus` | What the user pays for |

Some keys are both. Prime Video is the Thursday-night network *and* the app.
`sunday_ticket` is worse: the wire key means Sunday Ticket, the Settings label
is **YouTube TV** (`PLAN.md` §7, `gameDisplay.ts` `SERVICE_LABELS`). YouTube TV
is an MVPD. Sunday Ticket is an add-on that carries *out-of-market* Sunday
afternoon games. They are not the same subscription.

`seed-broadcasts.ts` then writes the mix into `game_broadcasts`: one rotating
OTA (`fox`/`cbs`/`nbc`/`abc` by game index) plus `sunday_ticket` plus
`nfl_plus`. Local Week 3 TNF is therefore **CBS** on the board while ESPN says
**Prime Video**. `rankBroadcasts` ranks those fixture rows against
`user_app_presence`. The Switch CTA and the board network column both read the
same polluted list.

The fix is a join, not a longer enum:

```
game airing (network, market)
  × carriage map (service → networks it carries, with window/market rules)
  × user_app_presence (services the user pays for)
  × deep-link table (service, network) → URL
  → ranked watch options
```

`networkLabel` reads airings only. `rankBroadcasts` reads the join.

---

## 1. Data model

### 1.1 Keep / replace

| Today | After |
|---|---|
| `game_broadcasts(game_id, service, deep_link_url, requires_subscription)` | **Retire.** No `source`, no `fetched_at`, no unique `(game_id, service)`, and `service` is the mixed enum. Seed deletes-then-inserts because there is nothing to upsert on. |
| `user_app_presence(user_id, service, has_subscription)` | **Keep.** `service` becomes a *user-service* key only. New CHECK. |
| `is_valid_streaming_service(s)` | **Split** into `is_valid_airing_network` and `is_valid_user_service`. The vMVPD migration (`20260918120000`) already shows that replacing the function is enough for existing CHECKs; do not rewrite `20260510120000`. |

Do not persist expanded watch options. They depend on the user and on the
carriage-map version. Computing them at read time keeps flex updates to one
airing write.

### 1.2 `game_airings` (new table)

One row per observed airing. ESPN Week 3 MNF is two rows (`espn`, `abc`), not
one `"ESPN/ABC"` string.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `game_id` | uuid FK → `games` | Indexed |
| `network` | text | CHECK `is_valid_airing_network` |
| `market` | text | `'national'` \| `'regional'` \| `'unknown'`. ESPN Week 3 only ever sent `National` / `national`. See §4. |
| `source` | text | `'espn_scoreboard'` for production writes; `'espn_scoreboard_fixture'` for seed rebuilt from a saved payload |
| `espn_media_name` | text | Raw media string (`"Prime Video"`, `"ESPN"`). Audit column. Never used for ranking. |
| `espn_type` | text null | `geoBroadcasts[].type.shortName` (`TV` / `Streaming`) when present |
| `fetched_at` | timestamptz | Last successful upsert for this row |
| UNIQUE | `(game_id, network, market)` | Idempotent upsert key |

RLS: same as `game_broadcasts` (authenticated SELECT, service_role ALL).

Join to `games` via the existing ESPN identity already used by live ingest:
`games.sportradar_id = 'seed:espn:' || event.id` (`scripts/fetch-nfl-schedule.ts`,
`experiments/liveIngestCore.ts`). Do not add an `espn_event_id` column in this
pass. The prefix is ugly and `PLAN.md` already treats it as temporary until
Sportradar ids exist; a third identifier does not help routing.

### 1.3 Airing-network catalog

Keys that may appear on `game_airings.network`. These are **not** picker
values.

| Key | ESPN media names (Week 3, complete) | Board label |
|---|---|---|
| `cbs` | `CBS` | CBS |
| `fox` | `FOX` | FOX |
| `nbc` | `NBC` | NBC |
| `abc` | `ABC` | ABC |
| `espn` | `ESPN` | ESPN |
| `amazon_prime` | `Prime Video` | PRIME |
| `peacock` | *(not in Week 3)* | PEACOCK |
| `nfl_network` | *(not in Week 3)* | NFLN |
| `netflix` | *(not in Week 3)* | NETFLIX |
| `espn_plus` | *(not in Week 3 as an airing)* | ESPN+ |
| `nfl_plus` | *(not in Week 3 as an airing)* | NFL+ |
| `paramount_plus` | *(not in Week 3 as an airing)* | PARAMOUNT+ |

`espn` is new. Linear ESPN is not `espn_plus`. The recon already called this
out; `PIVOT-STAKES-PLAN.md` §11.2 is stale when it says there is no bare
`espn` / `netflix` key.

Anything else ESPN sends is **unmapped**. Log `espn_media_name`, skip the row,
never invent a key. See §3.3.

### 1.4 User-service catalog

Keys that may appear on `user_app_presence.service`. These **are** picker
values.

| Key | Label | Kind |
|---|---|---|
| `youtube_tv` | YouTube TV | MVPD |
| `sunday_ticket` | NFL Sunday Ticket | Add-on (YouTube / YouTube TV). Out-of-market Sunday afternoon only. |
| `hulu_live` | Hulu + Live TV | MVPD (replaces `hulu`) |
| `fubo` | Fubo | MVPD |
| `directv` | DIRECTV | MVPD |
| `sling` | Sling TV | MVPD (new). Key only in v1 — empty carriage, no deep link. |
| `amazon_prime` | Prime Video | Standalone app *and* a network |
| `peacock` | Peacock | Standalone |
| `paramount_plus` | Paramount+ | Standalone |
| `espn_plus` | ESPN+ | Standalone |
| `nfl_plus` | NFL+ | Standalone. Phone/tablet local+primetime live does not fit TV switching — carriage is `nfl_plus` / `nfl_network` only. |

Dropped from the picker: `cbs`, `fox`, `nbc`, `abc`, `nfl_network`. Those are
networks. A user who can watch them does so through an MVPD that carries them,
or by reading the board's plain-text airing ("On FOX") with an antenna.

**Not in v1:** an `antenna` / `cable` / `broadcast_tv` picker option. Someone
with only an antenna still sees the network as text; they do not get a deep-link
CTA. Revisit as a future service key if we want an explicit "I watch on OTA"
presence row. See §1.7 and §9.1.

`amazon_prime` / `peacock` / `paramount_plus` / `espn_plus` / `nfl_plus` stay
on both lists on purpose. They air games and they are apps the user pays for.
`netflix` is network-catalog only until ESPN lists it and a URL is confirmed.

### 1.5 Carriage map (versioned config, not a table)

Committed TypeScript module, e.g. `shared/src/broadcast/carriageMap.ts` (or
`services/ingestion` if we refuse to add a shared broadcast package — either
is fine as long as the seed script and the API import the **same** module).

```
CarriageMapVersion {
  version: string          // '2026.1'
  effectiveFrom: string    // ISO date, documentation only
  entries: CarriageEntry[]
}

CarriageEntry {
  service: UserService
  networks: AiringNetwork[]
  windows?: WindowLabel[]  // default: all
  marketRule: 'any' | 'in_market' | 'out_of_market'
  requiresSubscription: true  // every user-service is paid in this model
  confirmed: boolean          // expansion uses only confirmed entries (B1.1)
}
```

Starting map. Rows with `confirmed: false` are never emitted by
`expandWatchOptions`. Mark `confirmed: true` only from
`experiments/carriage-confirm.md` (provider lineup pages) or from the
high-confidence standalone / Ticket rows. Sling stays empty. Unconfirmed
entries stay in the map for documentation but do not affect ranking.

| Service | Networks | Windows | Market rule | Confidence |
|---|---|---|---|---|
| `youtube_tv` | `cbs`, `fox`, `nbc`, `abc`, `espn`, `nfl_network` | all | `in_market` for `cbs`/`fox` regional slates; `any` for truly national networks | **Confirm** NFLN and ESPN package coverage |
| `sunday_ticket` | `cbs`, `fox` | `SUNDAY · EARLY`, `SUNDAY · LATE` only | `out_of_market` | High. Does **not** carry TNF / SNF / MNF / NFLN exclusives |
| `hulu_live` | `cbs`, `fox`, `nbc`, `abc`, `espn`, `nfl_network` | all | `in_market` for regional OTA | **Confirm** |
| `fubo` | same shape as `hulu_live` | all | `in_market` for regional OTA | **Confirm** |
| `directv` | same shape | all | `in_market` for regional OTA | **Confirm** |
| `sling` | **empty until probe** | — | — | Key exists so we do not migrate twice. Packages split FOX/NBC/ESPN across Orange/Blue and often omit CBS. Do not guess. |
| `amazon_prime` | `amazon_prime` | all | `any` | High |
| `peacock` | `peacock` | all | `any` | High for exclusives. Do **not** add `nbc` unless ESPN lists Peacock on that game. |
| `paramount_plus` | `paramount_plus` | all | `any` | Do not add `cbs` unless ESPN lists it |
| `espn_plus` | `espn_plus` | all | `any` | Do not add `espn`/`abc` unless ESPN lists ESPN+ |
| `nfl_plus` | `nfl_plus`, `nfl_network` | all | `any` | **Decided:** NFL+ / NFL Network only. Local and primetime games are phone/tablet-only and do not fit switching what's on the TV. Do not add `cbs`/`fox`. |

Rules:

1. A service carries a game only when the airing's `network` is in
   `networks`, the game's `groupWindow(kickoff)` is in `windows` (or
   `windows` is omitted), and `marketRule` is satisfied.
2. `in_market` / `out_of_market` cannot be evaluated until we have a user
   market or ESPN markets (§4). Until then the join still emits the option
   but tags `marketConfidence: 'unknown'` for regional CBS/FOX slates.
3. Never invent an airing from carriage. If ESPN listed only `CBS`, we do
   not also write an `espn_plus` airing because "maybe they stream it."
4. Bump `version` when the map changes mid-season (package shakeups,
   Christmas Netflix, Super Bowl simulcasts). Readers always use current
   HEAD. No need to stamp `carriage_version` on airing rows.

### 1.6 How `rankBroadcasts` changes

Today (`services/dispatcher/src/broadcastResolver.ts`):

```
rankBroadcasts(game_broadcasts rows, userServices)
  eligible = !requiresSubscription || userHas(row.service)
  sort: eligible first, then lagSecondsFor(service), then service name
  preferred = first eligible
```

OTA rows are seeded `requires_subscription: false`, so **FOX is preferred
for a user with zero presence**. That is the fixture talking, and it is
wrong for out-of-market Sunday games.

After:

```
expandWatchOptions(airings, carriageMap, deepLinks, kickoff) → WatchOption[]
  for each airing:
    for each carriage entry that carries airing.network under the window/market rules:
      emit {
        service,                  // user-service key (youtube_tv, not cbs)
        network,                  // airing network (cbs)
        deepLinkUrl,              // deepLinks[(service, network)]
        requiresSubscription: true,
        marketConfidence          // 'national' | 'unknown' | 'in' | 'out'
      }

rankBroadcasts(watchOptions, userServices)
  eligible = userServices.has(option.service)
  sort:
    1. eligible first
    2. on a Sunday · EARLY / Sunday · LATE regional CBS/FOX slate:
       if both sunday_ticket and an in-market MVPD (youtube_tv, hulu_live,
       fubo, directv) are eligible, sunday_ticket ranks first regardless of lag
    3. then lagSecondsFor(service), then service name
  preferred = first eligible
  // Always keep the local-channel route as the second option when Ticket won
  // via rule 2, labeled for in-market use (see §4.4).
```

`pickBroadcastSource` (`broadcastLag.ts`) uses the same expanded options
and the same eligibility. Timing source is the **user service**
(`youtube_tv`), not the network (`cbs`). Add lag entries for `youtube_tv`,
`hulu_live`, `sling`. Keep `sunday_ticket` at 75 until measured. `espn`
linear, if we ever time against it directly, needs its own number; until
then ESPN-via-YouTube-TV uses the `youtube_tv` lag.

**Regional Sunday ranking exception (decided §9.3):** most regional games
are out of market for any given user, so Ticket beats YTTV/Hulu/etc. on
`SUNDAY · EARLY` / `SUNDAY · LATE` CBS/FOX slates even when its lag is
higher. The local-channel route stays visible as option #2 with copy that
makes the in-market case obvious (e.g. "FOX on YouTube TV — if this game
is in your market"). National windows (TNF / SNF / MNF / single-network)
keep the plain lag tiebreak.

Wire shape of `GET /games/:id/broadcasts` and `GET /games?week=` stays
`{ service, deep_link_url, requires_subscription, user_has_subscription,
typical_lag_seconds, preferred }` so `NowActiveCard` still says
`Watch on ${serviceLabel(service)}` → "Watch on YouTube TV". Add two
fields, both additive:

- `network: string` — the airing this option is carrying
- `market_confidence: 'national' | 'unknown' | 'in' | 'out'`

When the Ticket-over-MVPD rule fires, also add an optional presentation
hint on the second option (e.g. `route_hint: 'in_market_local'`) so the
client can render the "if this game is in your market" label without
re-deriving the slate logic.

`GET /games?week=` also grows an `airings` array on each game
(`{ network, market, market_confidence }`) so `networkLabel` does not
have to reverse-engineer a network from ranked watch options. That is
the same mistake §11.2 already told us not to make with `rankBroadcasts`.

`BroadcastCatalog.getGameBroadcasts` becomes "load airings + expand" or
splits into `getGameAirings` + a pure `expandWatchOptions`. Either way
the in-memory catalog used by the harness and `delivery.ts` must speak
airings, not fixture service rows.

### 1.7 Empty presence — plain text, no CTA

Eligible-only ranking (no more free OTA for everyone) is a real product
change. A user who has not set presence gets **no preferred broadcast**
and **no Switch button** — not a disabled button. The card still shows
the airing as plain text: **"On FOX"** (or `"On PRIME"`, `"On ESPN"`,
etc.). Someone with an antenna can use that information without us
pretending we can deep-link them.

Do not keep a shadow `requires_subscription: false` on `cbs`/`fox` to
preserve the old tests. Update the tests. Decided §9.1.

Antenna / cable as an explicit picker option is **out of v1** (noted for
later). Until then, the board text is the antenna user's whole answer.

---

## 2. User preferences / presence migration

### 2.1 Streaming services are not preferences

Repo facts say unknown **preference** keys are silently stripped, and a
new key needs three coordinated edits: `shared/src/types/preferences.ts`,
`app/lib/me.ts`, `services/api/src/routes/me.ts` PATCH allow-list.

Streaming services do **not** live in `users.preferences`. They live in
`user_app_presence`, written by `POST /me/app-presence`. The zod schema
today is four keys (`notificationMode`, `quietHours`, `autoSwitch`,
`watchedLeagueIds`). Putting `youtube_tv` into preferences would be a
bug: `parsePreferences` would strip it and the toggle would "not persist"
with no error.

Two different failure modes, do not conflate them:

| Store | Unknown key | What the user sees |
|---|---|---|
| `users.preferences` via `parsePreferences` | **Silently stripped** | Setting vanishes |
| `POST /me/app-presence` `z.enum(STREAMING_SERVICES)` | **400 validation_error** | Save fails |
| `is_valid_streaming_service` CHECK | **Postgres error** if something bypasses zod | Save fails |

A user-market setting (§4 option C) *would* be a preference key and *would*
need the three-file edit plus a parse→serialize→parse round-trip test. It
is **not** in v1 (decided §9.6). Do not add it in the same commit as the
enum split.

### 2.2 Presence remap

`POST /me/app-presence` upserts on `(user_id, service)` and never deletes
omitted keys. Settings sends one service at a time. Onboarding, if the
user selected anything, writes **every** catalog key with
`has_subscription: selected.has(service)` (`onboarding-streaming.tsx`).
Skipped onboarding writes nothing.

Existing rows were chosen against today's labels. Remap from what the
user was told, not from the wire key's etymology.

**No compatibility shims.** No backend is deployed; only local/dev accounts
are affected. Cut over in one migration + one client release. The API does
not accept old keys during a transition window.

| Existing `service` | `has_subscription` | Write | Why |
|---|---|---|---|
| `sunday_ticket` | true | `youtube_tv = true`. **Do not** also set `sunday_ticket = true`. | Label was "YouTube TV". Ticket is a separate add-on. |
| `sunday_ticket` | false | `youtube_tv = false` | |
| `hulu` | any | `hulu_live` = same boolean | Label was "Hulu"; Live TV is what can carry NFL. |
| `fox` / `cbs` / `nbc` / `abc` | any | **drop** | Networks, not services. Antenna/cable is not a v1 picker option (§9.1). |
| `nfl_network` | any | **drop** | Network, not a service. Carriage covers it. |
| `espn_plus`, `paramount_plus`, `peacock`, `amazon_prime`, `nfl_plus`, `fubo`, `directv` | any | same key, same boolean | No rename |

Then delete the old keys (`sunday_ticket` as YouTube-TV-meaning, `hulu`,
the four OTA keys, `nfl_network`) in the same migration. The new zod enum
and CHECK only contain the §1.4 keys. A stale client that POSTs `cbs` or
the old-meaning `sunday_ticket` gets a 400 — acceptable for local-only
accounts.

`sunday_ticket` comes back as a **new** key with the honest label
"NFL Sunday Ticket". Existing users must toggle it. Surface a one-line
hint in Settings the first time after remap: "Do you also have Sunday
Ticket?" — copy only, not a new preference key. Decided §9.2.

### 2.3 Every file that mirrors the list

A new or renamed key that is not updated in all of these will fail
silently in one layer and loudly in another. Treat this as a checklist
for the migration commit.

**Catalog / CHECK (source of truth after the split: two enums, not one)**

1. New: `is_valid_airing_network` and `is_valid_user_service` (migration
   replacing `is_valid_streaming_service`).
2. `services/api/src/routes/me.ts` — `STREAMING_SERVICES` +
   `z.enum` on `POST /me/app-presence`. This is the allow-list that
   rejects unknown **service** keys. Not the preferences PATCH body.
3. `app/lib/streamingServices.ts` — `STREAMING_SERVICES`,
   `StreamingService`, `STREAMING_SERVICE_INFO` (label + App Store search).
4. `app/lib/me.ts` — `AppPresenceEntry.service: StreamingService` and
   `setAppPresence`. Does **not** list keys, but a renamed type here
   without a picker update won't compile.

**Labels and ranking**

5. `app/lib/gameDisplay.ts` — `SERVICE_LABELS` ("Watch on {service}").
6. `app/lib/gameDisplay.test.ts` — `sunday_ticket` → "YouTube TV" must
   become `youtube_tv` → "YouTube TV".
7. `app/lib/board.ts` — `asNetwork` exhaustive switch. After the split
   this switch is over **networks**, not `StreamingService`. Carriers
   disappear from it.
8. `app/lib/board.test.ts` — `CARRIERS` list and the "every catalog
   service is a network or a carrier" loop.
9. `services/dispatcher/src/broadcastLag.ts` — `BROADCAST_LAG_SECONDS`.
10. `services/dispatcher/src/broadcastLag.test.ts`
11. `services/dispatcher/src/broadcastResolver.test.ts`
12. `services/dispatcher/src/delivery.test.ts`
13. `services/api/src/routes/games.test.ts`

**Pickers**

14. `app/app/(app)/onboarding-streaming.tsx` — iterates
    `STREAMING_SERVICES`. Onboarding still writes presence, not
    preferences.
15. `app/app/(app)/(tabs)/settings.tsx` — `StreamingServicesSection`,
    same list, one-key PATCH.

**Seed, fixtures, harness**

16. `scripts/seed-broadcasts.ts` — `BROADCAST_TEMPLATES` +
    `buildBroadcastRows`. Replaced by the ESPN mapping (§6).
17. `scripts/seed-broadcasts.test.ts`
18. `experiments/live-sunday-harness.ts` — seeds `sunday_ticket` on
    every game and both users.
19. `experiments/verify-push-payload.ts`

**Docs that will lie after the split (fold in when the phase ships)**

20. `PLAN.md` §7 enum + the "do not rename `sunday_ticket`" sentence
    (that sentence is the thing this design reverses, deliberately).
21. `PIVOT-STAKES-PLAN.md` §11.2 networkLabel catalog note.

`shared/src/types/preferences.ts` is **not** on this list unless we add
a market key. Do not add service keys there.

---

## 3. Ingestion

### 3.1 Endpoint and fields

Use the same scoreboard the schedule seeder already hits:

```
GET https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard
    ?seasontype=2&week={n}
```

Saved: `experiments/logs/espn-scoreboard-2026-week3.json` (16 events,
2026 regular Week 3).

Per event, read `competitions[0]`:

| Field | Shape (Week 3) | Use |
|---|---|---|
| `geoBroadcasts[]` | `{ type: { id, shortName }, market: { id, type }, media: { shortName, logo? }, lang, region }` | **Primary.** One airing per entry. MNF is two entries (ESPN, ABC). |
| `broadcasts[]` | `{ market: "national", names: string[] }` | Fallback if `geoBroadcasts` is missing. Same names, less structure. MNF is one entry with `names: ["ESPN","ABC"]`. |
| `broadcast` | string (`"Prime Video"`, `"ESPN/ABC"`) | Display crumb only. Do **not** parse `"ESPN/ABC"` — it collapses a simulcast. |

`espnScoreboardEventSchema` (`espnTypes.ts`) currently strips both
`broadcasts` and `geoBroadcasts`. The play-by-play client can keep
stripping them. Broadcast ingest uses its own schema, same swap-ready
boundary as `EspnPlaySource`.

Week 3 `geoBroadcasts` never included a DMA, a city, or a station. Every
`market.type` was `National`, every `region` was `us`, every `lang` was
`en`. `broadcasts[].market` was the string `"national"`. That is the
regional-Sunday problem (§4), not a reason to prefer `broadcasts`.

### 3.2 Why `geoBroadcasts` over `broadcasts`

1. Simulcasts are already split (two objects, not a slash-name).
2. `type.shortName` distinguishes `TV` vs `Streaming` (TNF Prime is
   Streaming; MNF ESPN and ABC are both TV).
3. `media.shortName` is the mapping input. It matched `broadcasts[].names`
   on every Week 3 game.

If a future payload has `broadcasts` and no `geoBroadcasts`, split
`names[]` into one airing each and set `espn_type` null.

### 3.3 Media-name → network-key

Pure function, one module, used by production ingest **and** the seed
rebuild (§6). Exhaustive on the names we have seen. Default: unmapped.

| `media.shortName` / `broadcasts[].names[]` | Network key |
|---|---|
| `CBS` | `cbs` |
| `FOX` | `fox` |
| `NBC` | `nbc` |
| `ABC` | `abc` |
| `ESPN` | `espn` |
| `Prime Video` | `amazon_prime` |

Expected but unseen in Week 3 — add only when a saved payload contains
them, not from memory:

`NFL Network`, `NFLN`, `Peacock`, `Netflix`, `ESPN+`, `ESPN Plus`,
`NFL+`, `NFL Plus`, `Paramount+`, `Paramount Plus`, `Amazon`,
`Amazon Prime`, `Prime`, `FOX Sports`, `FS1`, `USA`, `CBS Sports
Network`, `NFL RedZone`, `YouTube`, `YouTube TV`, `Apple TV`,
`Dallas Cowboys`, local station call signs.

Unmapped behavior, non-negotiable:

1. Log `event.id`, `shortName`, the raw string, and `source`.
2. Do not write an airing.
3. Do not alias (`"Prime"` ↛ `amazon_prime`).
4. A game with every name unmapped has zero airings. `networkLabel`
   returns null. No Switch CTA (same empty-presence treatment as §1.7).
   That is better than "CBS" on TNF.

Simulcast: ESPN already split ESPN and ABC in `geoBroadcasts`. Two
mapped names → two rows. Do not also parse `broadcast: "ESPN/ABC"`.

### 3.4 Write cadence and upsert

| When | Cadence | Why |
|---|---|---|
| Off / preseason / Tue–Wed | Daily | Schedule is stable |
| Thu–Mon in season | Every 15 minutes | Flex, late network changes, international notes |
| First run of a week | Immediate | Board should not wait for the next daily tick |

Idempotent write, per game, in one transaction:

1. Map the event's geos → candidate `(network, market)` rows.
2. `INSERT … ON CONFLICT (game_id, network, market) DO UPDATE SET
   espn_media_name, espn_type, source, fetched_at`.
3. `DELETE FROM game_airings WHERE game_id = $1 AND (network, market)
   NOT IN (candidates)`. A FOX→NBC flex drops FOX.

Do not touch other games in that statement. Do not delete-all-then-insert
the way `seed-broadcasts.ts` does today.

`games` rows must already exist (`pnpm seed:schedule` or whatever P0
uses). An ESPN event with no `seed:espn:{id}` match is logged and
skipped — same as `liveIngestCore.ts`. Do not create games from
broadcast ingest.

### 3.5 Late changes (flex)

Flex is a deleted-and-replaced airing, not a versioned history. We do
not need `game_airings_history` in v1. `fetched_at` is enough to debug
"when did we last see this."

Sunday 4:25 national designation moving from one CBS game to another
will look identical to ESPN (both already `National`). Ingest cannot
fix that. See §4.

### 3.6 Where it runs

Facts as of the design pass (2026-09-24 / recon):

- `services/api/src/worker.ts` only syncs lineups, every 5 minutes.
- `services/ingestion/src/index.ts` re-exports the ESPN play client. It
  does not run a process.
- The only ESPN → notification path is `experiments/live-sunday-harness.ts`.
- Local `services/api/.env` pointed at `127.0.0.1`.

**Update (2026-09-25):** As of that morning, no Fly app or hosted
Supabase existed. Parker has since created a Fly account. Deploy config
(`Dockerfile`, `fly.toml`, `GET /health`, worker start scripts, remote-
safety seed guards) lives in `docs/D1-DEPLOY-RUNBOOK.md`. D1.1 config is
in the repo; **no `fly deploy` / secrets yet** — Parker owns hosted
steps. Broadcast ingest still has no production runner to ride until P0
(+ hosted DB secrets). It is not play-by-play. It must not go inside
`EspnPlaySource.subscribe()`.

**Until P0 + a hosted DB with secrets**

- Rebuild local `game_airings` from a saved or live scoreboard via the
  same mapping module (`pnpm seed:broadcasts` rewritten, §6).
- The simulator board is the verification surface.
- No Fly job for broadcasts yet. Follow D1 for when the app is hosted.

**Once P0's production runner exists**

P0 is specified as a long-lived process that owns one `EspnPlaySource`
per live game (`Promise.all` from the harness), plus
`watchForResumption`, a silence ceiling, and per-game collapse. That
process is the first production thing that already talks to ESPN on a
timer.

Broadcast ingest is a **sibling cycle** on that runner (or on the
existing lineup-sync worker — same idea, cheaper than a fourth Fly
process):

```
P0 runner
  ├─ play loops          (per live game, 5s poll)
  ├─ broadcast cycle     (scoreboard, 15 min / daily — this design)
  └─ (optional) lineup   (already in worker.ts; do not move it here
                          unless P0's design says to collapse workers)
```

PLAN.md §6 still says three Fly processes (API+WS, ingestion, engine+
dispatcher). P0's own design pass should decide whether broadcast
ingest rides the ingestion process or the lineup worker. B1's constraint:
it is schedule-cadence, idempotent, and safe to start before any game
is live. It is not blocked on resumption-watcher work.

§0.3 still applies: no production deploys on Thu/Sun/Mon. The first
hosted write of `game_airings` happens on a Tuesday–Wednesday, after
the mapping has been verified locally against a saved Week 3 payload
and at least one later week.

If `fly secrets list -a pivot-api` later shows a hosted `SUPABASE_URL`,
stop and inspect `game_broadcasts` before any upsert (recon §1). Seed
pattern vs. real airings is how you tell the two apart.

### 3.7 Fit with P0 — what B1 does not wait for

| P0 deliverable | Blocks B1? |
|---|---|
| Production `EspnPlaySource` loops | No. Different endpoint, different cadence. |
| `watchForResumption` replacing `lagSecondsFor` padding | No. Ranking still uses lag as a **tiebreak**, not as fire-time. The v1.5 "timing source is a guess" Known Issue (`PLAN.md`) is adjacent but out of scope. |
| Silence ceiling / per-game collapse | No. |
| Hosted runner process | Blocks **hosted** ingest only. Local seed does not wait. |
| Replayable `events-*.jsonl` | No. Broadcast fixtures are scoreboard JSON, already saved. |

UI phases U1–U3 already consume `networkLabel`. U2 can keep its current
helper until B1.4 switches the input to airings. Do not block U2 on B1.

### 3.8 Probes (do not guess)

**`experiments/espn-broadcast-map-probe.ts`** (can run any day)

1. Fetch scoreboard `seasontype=2&week=N` for the current week and one
   completed week.
2. Dump every distinct `broadcasts[].names[]`, `geoBroadcasts[].media.shortName`,
   `broadcast`, `type`, `market`, `region`.
3. Run them through the mapping function. Print mapped vs. unmapped.
4. Save the raw JSON under `experiments/logs/espn-scoreboard-{year}-week{n}.json`.
5. Stop. The mapping table is only extended from this dump.

**`experiments/espn-broadcast-market-probe.ts`** (the §4 question)

See §4.2. Do not implement market UI until this probe reports.

**`experiments/carriage-confirm.md`** (desk research + optional live check)

For each MVPD in the starting map, confirm live-NFL carriage from the
provider's own "channel line-up" page, not from memory. Sling stays
empty until confirmed. NFL+ is decided (§9.9): `nfl_plus` + `nfl_network`
only. This is a markdown report, not a script.

---

## 4. Regional Sunday games

### 4.1 What Week 3 actually shows

Every Sunday 1:00 / 4:05 / 4:25 CBS or FOX game is listed as `national`
/ `National`. There are no local-only entries, no DMA ids, no station
call signs, no `market.id` other than `1`.

| Window (ET) | Games | ESPN network | Reality |
|---|---|---|---|
| Sun 1:00 | 9 games | FOX ×4, CBS ×5, all National | Classic regional split |
| Sun 4:05 | ARI@SF, MIN@TB | FOX National | Regional FOX |
| Sun 4:25 | BAL vs DAL (Rio note), LV@NO | CBS National | One is usually the national CBS game; ESPN does not say which |
| Sun 8:20 | LAR@DEN | NBC National | Actually national (SNF) |
| Mon 8:15 | PHI@CHI | ESPN + ABC National | Actually national (MNF simulcast) |
| Thu 8:15 | ATL@GB | Prime Video National | Actually national (TNF) |

Heuristic we *can* compute without ESPN's help: a `(window, network)`
bucket with **more than one** `cbs`/`fox` game is a `regional_slate`.
A bucket of one (SNF, MNF, TNF, a lone international) is `national`.
The 4:25 CBS pair is two rows in a regional_slate even if one of them
is the national game. We will not pretend to know which.

### 4.2 Options

**A. Copy only.** Board and Switch stay honest: Sunday regional CBS/FOX
shows the network plus "May not be in your market." No new setting.
Sunday Ticket users still get a real watch option on every game in
those windows (that is what Ticket is for).

**B. Probe ESPN (and cousins) for markets, then decide.** Do this
before building a market picker. Candidate URLs, each saved under
`experiments/logs/` even when empty:

- Scoreboard with extras: `dates=YYYYMMDD`, `limit=`, `calendartype=`,
  `region=`, `lang=`, `tz=`.
- `…/summary?event={id}` — `header.competitions[0]` may carry a richer
  `geoBroadcasts` than the board.
- ESPN core API, most likely to have structured broadcast refs if
  anything does:
  `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/{id}/competitions/{id}/broadcasts`
  (competition id equals event id on the Week 3 payload).
- Site web API variants under `site.web.api.espn.com` if the core URL
  404s.
- One request from a non-US `Accept-Language` / `geo` header to see
  whether `region` ever leaves `us`.

Pass: any DMA, city, station, or non-`National` market on a Sunday
regional game. Fail: same `National` everywhere. On fail, do not scrape
506sports or NFL.com local-TV maps in v1 (licensing and brittleness).
Come back to Parker with the dump.

**C. User market setting.** ZIP or DMA in `preferences.homeMarket`.
Three-file edit (silent-strip risk). We still need a DMA→games table
nobody in this repo has. Building that ourselves is a data product.
Only do this if B fails *and* Ticket-only + copy is not good enough.

### 4.3 Decision

**Ship A. Run B as an `experiments/` probe. Do not build C.**

Decided §9.6. Hedge copy ships with the mapping; the market probe is
additive evidence, not a gate.

A is enough for v1 because:

- TNF / SNF / MNF / single-network windows are truly national. Copy
  stays clean (`PRIME`, `NBC`, `ESPN`).
- The painful case is Sunday 1pm/4pm, and Sunday Ticket is the product
  that solves it. Users who have Ticket get every regional game, ranked
  first (§9.3).
- Users who have only YouTube TV (or Hulu Live, etc.) get a CBS/FOX
  option tagged `market_confidence: 'unknown'` and the hedge line —
  and, when Ticket is also present, that local route is option #2 with
  in-market labeling.
  Deep-linking them into YouTube TV's search for that matchup is still
  useful — YTTV will play it if it is in-market and fail clearly if not.

### 4.4 What the user sees

Assume a Sunday 1pm ET game ESPN lists as FOX, `regional_slate`.

| User has | Board column | Switch CTA | If they tap Switch |
|---|---|---|---|
| Nothing | `FOX` | **No button.** Plain text **"On FOX"** where the CTA would be. | — |
| `youtube_tv`, no Ticket | `FOX` | "Watch on YouTube TV" | YTTV search for the matchup. Hedge: "This FOX game may not be in your market." `market_confidence: 'unknown'`. |
| `sunday_ticket` only | `FOX` | "Watch on NFL Sunday Ticket" | YTTV/Ticket search. No hedge — Ticket is supposed to have this game. |
| `sunday_ticket` + `youtube_tv` | `FOX` | Preferred: "Watch on NFL Sunday Ticket". Second option: **"FOX on YouTube TV — if this game is in your market"** | Ticket first (§9.3). Local-channel route always shown second with that label. |
| `amazon_prime` only | `FOX` | **No button.** Plain text **"On FOX"**. | Prime does not carry Sunday regional FOX. Correct. |
| `nfl_plus` only | `FOX` | **No button.** Plain text **"On FOX"**. | NFL+ does not carry Sunday regional FOX (§9.9). |

Hedge copy lives on the Switch sheet and the ranked-broadcast picker,
not in the board column. The column is 38–40pt and already tight.
Featured card meta stays `1:00 PM · FOX`. Empty-presence "On FOX" is
the only place the airing is spelled with the "On " prefix — the board
column stays the short token.

Out-of-market, no Ticket: we cannot know we are out-of-market, so we
never say "you cannot watch this." We say it may not be in your
market, and we still offer the MVPD deep link.

---

## 5. Deep links

Keyed by `(service, network)`, not by network alone. A YouTube TV user
watching a CBS game must open YouTube TV, not CBS Sports. CBS Sports
and NBC Sports still have no usable AASA (`PLAN.md` Known Issues) —
routing those users through an MVPD is the only way they get an app
hand-off.

Templates take `{query}` — **format unlocked until B1.5**. The path
pattern `https://tv.youtube.com/search/{query}` is known-working; which
query string lands closest to the live game is not. B1.5 must test three
forms on a phone against a real upcoming game and keep the winner:

1. Abbreviations: `ATL vs GB`
2. Full team names: `Falcons Packers`
3. Network: `FOX`

Do not hard-code a format in the deep-link table before that device
check. Record pass/fail for each form in the B1.5 commit message or a
short note under `experiments/logs/`.

| Service | Network | URL | Status |
|---|---|---|---|
| `youtube_tv` | any network it carries | `https://tv.youtube.com/search/{query}` | Path **known-working**. Query format TBD in B1.5 (§9.8). Not in `BROADCAST_TEMPLATES` today (that file uses `/live`). YouTube TV AASA claims `*` after a `NOT /` deny, so `/search/…` is in the claimed set. |
| `sunday_ticket` | `cbs`, `fox` | same `https://tv.youtube.com/search/{query}` | Inferred. Ticket lives inside YouTube / YouTube TV. **Not separately verified.** Same query winner as YTTV. |
| `amazon_prime` | `amazon_prime` | `https://www.primevideo.com/` | App-level AASA verified (Sprint 10). **Not a game.** |
| `espn_plus` | `espn_plus` | `https://www.espn.com/nfl/team` | Production `com.espn.ScoreCenter` claims this path. `/watch/*` is dogfood-only. **Not a game.** |
| `peacock` | `peacock` | `https://www.peacocktv.com/watch/sports` | App-level, seed-claimed. **Game-level unverified.** |
| `paramount_plus` | `paramount_plus` | `https://www.paramountplus.com/` | AASA claims `/`. **Game-level unverified.** |
| `nfl_plus` | `nfl_plus` / `nfl_network` | `https://www.nfl.com/scores` | App-level. **Game-level unverified.** |
| `hulu_live` | any it carries | `https://www.hulu.com/hub/sports` | **AASA not audited** (seed header already says so). |
| `fubo` | any it carries | `https://www.fubo.tv/` | **AASA not audited.** |
| `directv` | any it carries | `https://www.directv.com/` | **AASA not audited.** Root URLs are how the Sprint 10 bug happened. |
| `sling` | any it carries | none | **No URL. Do not invent one.** Empty carriage means this row never emits. |
| `netflix` | `netflix` | none | **No URL. Do not invent one.** |
| Linear OTA (`cbs`/`fox`/`nbc`/`abc`/`espn`) via an MVPD | — | Use the MVPD's URL above | Antenna users get plain-text "On FOX", not these rows. CBS/NBC AASA is unusable (`PLAN.md` Known Issues); do not deep-link `cbssports.com` / `nbcsports.com` as a v1 path. |
| YouTube TV `/watch/{videoId}` | — | `https://tv.youtube.com/watch/{videoId}` | Device-verified game-level (`PLAN.md` Open Question #2). **Unusable** until we have a content-id source. Out of scope for B1. |

`BROADCAST_TEMPLATES` becomes this table. The seed no longer stores a
URL on an airing row. The expander fills `deepLinkUrl` at read time.

Unverified rows still ship as app-level landings with copy that does
not promise the game. A user who also has `youtube_tv` will rank YTTV
(or Ticket, on regional Sundays) first and rarely hit the weaker URLs.

Do not add `LSApplicationQueriesSchemes` custom-scheme fallbacks for
CBS/NBC. PLAN.md already rejected that.

---

## 6. Seed and fixtures

The simulator board has to match ESPN, not `otaForIndex`.

```
saved scoreboard JSON
  → same parseEspnAirings / mapMediaName as production
  → join games on sportradar_id = 'seed:espn:' || event.id
  → upsert game_airings (source = 'espn_scoreboard_fixture')
```

`scripts/seed-broadcasts.ts` loses `OTA_ROTATION`, `buildBroadcastRows`,
and per-row `BROADCAST_TEMPLATES` writes. It gains a path argument
defaulting to `experiments/logs/espn-scoreboard-2026-week3.json`, with
`--live` to fetch the current week instead.

`scripts/fetch-nfl-schedule.ts` does **not** start writing airings. One
job, one write. Schedule seed stays schedule seed.

Tests:

1. Mapping unit tests against the Week 3 dump: 16 events, expected
   networks. TNF `amazon_prime`. MNF `{espn, abc}`. Nine 1pm games
   split FOX/CBS as in the table in recon §3. Rio note ignored.
2. Unmapped-name test: a fixture with `"XYZ Sports"` writes nothing and
   records a log call.
3. `buildBroadcastRows` / `otaForIndex` tests are deleted, not updated
   to a new rotation.
4. Board test that currently seeds TNF as `amazon_prime` already
   expects `PRIME` — keep it. Add a case that would have failed under
   the old seeder: ATL@GB is Prime, not CBS.

Until `game_airings` exists, the rewritten seeder can still write the
old `game_broadcasts` shape **as a temporary compatibility dump** of
*networks only* (no synthetic `sunday_ticket` / `nfl_plus` rows). That
compat write dies in the same commit that switches readers. Do not
leave a dual-write around for a week.

Harness (`live-sunday-harness.ts`) currently stamps `sunday_ticket` on
every game so delivery resolves. After the split it should stamp the
real airings from the scoreboard it already fetches for `--list`, then
subscribe the watched user to `youtube_tv` + `sunday_ticket`. That is
a harness change, not a production change.

---

## 7. `networkLabel`

### 7.1 New input

Today (`app/lib/board.ts`):

```
networkLabel(broadcasts: GameBroadcast[]): string | null
```

`GameBroadcast` is a **ranked watch option** (`service` may be
`sunday_ticket`). `asNetwork` then tries to treat that service as a
network and returns null for carriers. It works only because the seeder
puts one OTA key in the list. After ESPN writes real airings, the
ranked list for a FOX game might be `[youtube_tv, sunday_ticket]` with
no `fox` key at all, and `networkLabel` would return null.

New input is airings:

```
networkLabel(airings: { network: string }[]): string | null
```

`asNetwork` becomes an exhaustive switch over `AiringNetwork`. Carriers
are not in that type. The U2 board tests that loop `STREAMING_SERVICES`
move to a loop over the network catalog.

`GET /games?week=` must supply `airings` (or a precomputed
`network_label`) so Home does not call `networkLabel` on `broadcasts`.
`FeaturedStakeCard` already does `networkLabel(game.broadcasts)` — that
call site changes in the same commit.

### 7.2 Simulcast winner

Ranks, lower wins, same spirit as today's OTA-first order:

| Rank | Network | Label |
|---|---|---|
| 0 | `cbs` | CBS |
| 1 | `fox` | FOX |
| 2 | `nbc` | NBC |
| 3 | `espn` | ESPN |
| 4 | `abc` | ABC |
| 5 | `amazon_prime` | PRIME |
| 6 | `peacock` | PEACOCK |
| 7 | `nfl_network` | NFLN |
| 8 | `netflix` | NETFLIX |
| 9 | `espn_plus` | ESPN+ |
| 10 | `paramount_plus` | PARAMOUNT+ |
| 11 | `nfl_plus` | NFL+ |

Week 3 MNF is `espn` + `abc`. **ESPN wins** (decided §9.4). ESPN is
MNF's home; ABC is a partial simulcast. This only changes the board
column. Routing still expands both airings and picks whichever service
the user can actually get.

The ranked Switch list still shows both networks' carriers. Collapse
same `service` on a simulcast to one option; prefer the winning
network's deep-link query (ESPN). Do not show "YouTube TV" twice.

Unknown network keys: ignore (same as today's
`some_new_service` → null). Do not echo the raw ESPN string onto the
board.

---

## 8. Phasing

Each phase is a gated commit: baseline `pnpm test` at repo root →
change → verify → Parker on-device where UI moved → commit. Never
`pnpm --filter app test` (zero tests). No production deploy on
Thu/Sun/Mon.

| Phase | Scope | Migration? | Baseline | Verify | Model |
|---|---|---|---|---|---|
| **B1.0** | This doc + §9 decisions | No | — | Parker signed off 2026-09-25 | Opus 5, High, MAX (done) |
| **B1.1** | Pure mapping + carriage + `asNetwork` over networks. Tests against the Week 3 dump. No DB, no UI. Unmapped names log and skip. Ticket-over-MVPD ranking rule as a pure function. | No | `pnpm test` count | New tests: every Week 3 event maps to the recon table; `"XYZ Sports"` is unmapped; MNF → `{espn, abc}`; **ESPN** wins `networkLabel`. Regional Sunday: Ticket preferred over YTTV when both eligible; local route stays second. | Auto |
| **B1.2** | Rewrite `seed-broadcasts` to run B1.1 over the saved JSON (or `--live`). Still writes **old** `game_broadcasts` as network-only rows (no synthetic Ticket/NFL+). | No | Local board screenshot *before* (TNF = CBS) | Re-seed local Supabase. TNF ATL@GB is Prime. MNF lists ESPN+ABC networks; board label ESPN. `pnpm test`. Simulator board screenshot *after*. | Auto |
| **B1.3** | Enum split + presence remap. New CHECKs, `game_airings` table, one-shot remap+delete of old keys, pickers show the new service list (incl. Sling key, no Antenna), `SERVICE_LABELS` / `STREAMING_SERVICE_INFO` / onboarding / Settings. **No API compat shims for old keys. No market preference.** | **Yes** (one SQL: two CHECK functions, new table, presence UPDATE/DELETE) | `pnpm test`; dump `user_app_presence` for the local test user | After remap: a row that was `sunday_ticket=true` is `youtube_tv=true` and `sunday_ticket` is absent. `hulu` → `hulu_live`. OTA keys and `nfl_network` gone. POST of `cbs` or old-meaning `sunday_ticket` → 400. `pnpm typecheck`. On device: Settings list is the new labels; toggling YouTube TV persists; Sunday Ticket is a separate toggle. | Opus 5, High, MAX |
| **B1.4** | Readers use airings. `rankBroadcasts` + `pickBroadcastSource` take expanded options (incl. Ticket-over-MVPD + second-option label). `GET /games` grows `airings`. `networkLabel` input switches. Drop the compat `game_broadcasts` write. Delivery / harness catalogs updated. Lag table gains new service keys. Empty presence → plain **"On FOX"**, no button. | Optional drop of `game_broadcasts` **in this commit or B1.4b** — prefer a second commit so a revert does not restore the mixed enum | `pnpm test`; Week 3 board screenshot from B1.2 | Same board labels. Switch CTA on TNF with only Prime selected: "Watch on Prime Video." Sunday FOX with Ticket+YTTV: Ticket preferred, YTTV second with in-market label. User with no presence: **"On FOX"**, no CTA. All previous `rankBroadcasts` tests rewritten. | Opus 5, High, MAX |
| **B1.4b** | Drop `game_broadcasts` + old CHECK if not done in B1.4. Update `database.types.ts`. | **Yes** | `pnpm test` after B1.4 | No remaining `from('game_broadcasts')`. Types regenerate. | Auto |
| **B1.5** | Deep-link table as `(service, network)`. YTTV search path. **Device-test three query forms** against a real upcoming game: `ATL vs GB`, `Falcons Packers`, `FOX`. Keep the winner. Unverified rows flagged in comments. | No | Device: current `/live` YouTube TV hand-off still works | Device: each of the three `/search/{query}` forms opens YTTV; record which lands closest to the game. Do not claim game-level for anyone else. | Auto |
| **B1.6** | Ingest writer: scoreboard fetch → map → upsert `game_airings`. Runnable as `pnpm seed:broadcasts --live` and as a function P0 can call. 15-min / daily cadence is a parameter, not a Fly cron. | No | Local DB airings from B1.2 | `--live` against the current week produces the same rows as running the mapper over a freshly saved JSON. Flex delete: hand-edit a fixture to swap FOX→NBC, re-run, FOX row gone. | Auto |
| **B1.7** | Hook B1.6 into P0's runner as a sibling cycle. **Blocked on P0 design + hosted DB.** | No | P0 runner green on a weekday | One hosted cycle on a Tue/Wed writes `source='espn_scoreboard'` rows that match the local mapping. Fly secrets / D1 hosted steps first (recon §1, `docs/D1-DEPLOY-RUNBOOK.md`). | Opus 5, High, MAX |
| **B1.8** | Regional hedge copy (option A) + `experiments/espn-broadcast-market-probe.ts` report. **No user-market / ZIP setting.** | No | Board / Switch screenshots | Hedge appears on Sunday regional FOX/CBS sheets only, not on TNF/SNF/MNF. Ticket users do not see the hedge on the preferred CTA; the second (local) option still carries the in-market label. Probe report committed under `experiments/`. | Auto |

§9 is decided. B1.1 can start. B1.7 cannot start before P0.

---

## 9. Decisions (Parker, 2026-09-25)

Was "Open questions." All ten are decided. Do not re-litigate without an
explicit plan change.

1. **No services selected.** No deep-link CTA. Still show the airing as
   plain text **"On FOX"** (no disabled button). Antenna users can read
   it. An `antenna` / `cable` / `broadcast_tv` picker option is a
   possible future service — **not in v1**.

2. **`sunday_ticket` remap → `youtube_tv` only.** Yes. No backend is
   deployed, so only dev accounts are affected. Keep the migration
   simple: one-shot remap + delete. **No API compatibility shims** for
   old keys.

3. **Ticket vs YTTV on regional Sunday slots.** Prefer Ticket for
   Sunday 1pm/4pm CBS/FOX games (most are out of market for any given
   user). Always show the local-channel route as the second option,
   labeled so the user knows it is the one to use if the game is in
   their market.

4. **MNF board label.** **ESPN**, not ABC. ESPN is MNF's home; ABC is a
   partial simulcast. Routing still picks whichever of the two the user
   can get; this only changes `networkLabel`.

5. **Sling and Netflix.** Add the keys now. No carriage, no URL for
   either until confirmed.

6. **ZIP / user market.** No. Ship the hedge copy. Add
   `experiments/espn-broadcast-market-probe.ts` (and save dumps under
   `experiments/logs/`).

7. **Hosted Supabase / Fly.** As of 2026-09-25 morning, no Fly app or
   hosted Supabase existed. Parker has since created a Fly account;
   deploy config is in `docs/D1-DEPLOY-RUNBOOK.md` (D1.1 in repo, no
   deploy/secrets yet). B1.1–B1.6 stay local regardless.

8. **YTTV search query.** Do not lock the format yet. B1.5 must test
   three forms on a phone against a real upcoming game: `ATL vs GB`,
   full team names (`Falcons Packers`), and the network (`FOX`). Use
   whichever lands closest to the game.

9. **NFL+.** Treat as NFL+ / NFL Network only. Its local and primetime
   games are phone/tablet-only, which does not fit switching what's on
   the TV. Do not give NFL+ users Sunday regional FOX/CBS.

10. **`preferredService` preference.** Not in B1. Agreed. Remains the
    v1.5 Known Issue in `PLAN.md`.

---

## 10. Out of scope

- Content-id acquisition for `/watch/{videoId}` (Open Question #2 in
  PLAN.md). App-level + YTTV search is the B1 ceiling.
- Scraping 506sports / NFL local-TV maps.
- Writing `game_airings` from inside `EspnPlaySource`.
- Changing reveal timing, `lagSecondsFor` padding, or per-game
  collapse (P0).
- Adding streaming keys to `preferencesSchema`.
- A user-market / ZIP preference (§9.6).
- An Antenna / cable picker option (§9.1) — noted for later.
- API compatibility shims for old `STREAMING_SERVICES` keys (§9.2).
- Deploying Fly, linking a hosted Supabase, or running ingest on a
  game day.
- Gold-plating carriage for every Sling tier.
- Locking the YTTV search query format before the B1.5 device check.
