# Testing Rules for Live Gamedays

Startup order for testing the latency-sync feature against a real live NFL slate. Run each
numbered step in its own terminal tab and confirm it's actually up before starting the next —
skipping ahead is the #1 cause of confusing failures later in the list.

See `RUNBOOK.md` for the full local-dev reference this is distilled from (including one-time
setup and general troubleshooting not specific to live gameday testing).

---

## 1. Docker Desktop

Open the Docker Desktop app manually. Wait until it shows "running." `supabase start` (next
step) silently hangs/fails without this.

## 2. Supabase (local)

```bash
supabase start
supabase status   # confirm it's up
```

Skip the reseed below if you already seeded this DB and haven't reset it since:

```bash
pnpm seed:players     # required after first start or a DB reset
pnpm seed:schedule
```



## 3. API server

```bash
pnpm --filter @pivot/api dev
```

Wait for: `Server listening at http://127.0.0.1:3000` (and it'll also print your LAN/USB
addresses — worth noting for step 4).

## 4. App on the phone — the IP gotcha

**This is the step that ate the most time on Sept 13.** The phone can't reach `127.0.0.1`, and
`EXPO_PUBLIC_*` vars in `app/.env` are baked in at Metro **bundle** time — editing `.env` does
nothing until Metro restarts with `--clear`.

1. **Try Wi-Fi first**, same network as the Mac:
  ```bash
   ipconfig getifaddr en0        # e.g. 192.168.12.24
  ```
   Set in `app/.env`:
2. **If the phone can't load anything over Wi-Fi** (e.g. "fetch failed" on sign-in, or Safari
  can't load `http://<en0-ip>:3000/` from the phone at all) — this usually means router/AP
   **client isolation** (happened on the "Dukeblue" network Sept 13), not a code bug. Switch to
   USB:
   Set **both** URLs in `app/.env` to that address instead:
3. **Restart Metro with** `--clear` **after any** `.env` **change** (not optional — a running Metro
  keeps serving the old inlined values):
4. Sign in on the phone. If it still won't connect, kill Metro (`Ctrl-C`, or `lsof -ti :8081 |
  xargs kill -9`) and re-run step 3 — don't just retry the app.



## 5. Capture the push token (once per install)

The harness needs a real Expo push token to actually deliver pushes to your phone instead of
just logging them.

1. With the app signed in, check the Metro log for:
  ```
   [push] registering token via POST /me/push-token
  ```
2. Grab the token (from that log line, or `select expo_push_token from users where id = '<your
  user id>';`against local Postgres) and save it — this file lives in`/tmp`, so it does
   **not** survive a reboot and should be re-created if missing or after a fresh install:



## 6. Ground-truth capture tools

Run both, side by side with your YouTube TV window — these are what let you compute
push-vs-broadcast gaps after the fact instead of trusting reaction time live.

```bash
npx tsx experiments/mark-visible.ts       # Enter (optionally with a note first) the instant
                                           # a play becomes visible on the broadcast
npx tsx experiments/reference-clock.ts    # live millisecond clock — keep in the screen
                                           # recording frame if you're also recording
```



## 7. Find today's ESPN game ids

```bash
npx tsx experiments/live-sunday-harness.ts --list
```

Prints today's scoreboard with each game's ESPN event id, then exits. Use these for `--watch`
below — `--watch` is for games actually on your screen (resumption-gated **and** pushed);
`--data auto` fills in the rest of today's slate as log-only (never pushed, doesn't compete for
your rate-limit quota).

## 8. Start the harness

```bash
cd /Users/parkerjones/Developer/projects/pivot && \
  source /tmp/pivot_push_token.env && \
  rm -f /tmp/live-harness-run.log && \
  npx tsx experiments/live-sunday-harness.ts --watch <game_ids> --data auto > /tmp/live-harness-run.log 2>&1
```

---



## Mid-test gotcha: rebuild before restarting, if you touched engine/dispatcher/ingestion code

**Silent failure risk.** `@pivot/engine`, `@pivot/dispatcher`, and `@pivot/ingestion` each
resolve via their `package.json`'s `main` → `./dist/index.js` — **not** live TypeScript source.
If you patch a bug in `services/engine/src/*.ts` (or dispatcher/ingestion) mid-slate, like the
timeout-flapping and kickoff-gating fixes on Sept 13, the harness will keep running the **old,
unpatched, compiled code** until you rebuild:

```bash
pnpm --filter @pivot/engine build        # or @pivot/dispatcher / @pivot/ingestion, as needed
```

Then kill and restart the harness (step 8). There's no warning if you skip this — it just quietly
doesn't pick up your fix, which reads exactly like the bug is still there.

## Quick troubleshooting


| Symptom                                                          | Likely cause                                                                                             |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Phone shows "fetch failed" / stuck on sign-in                    | `.env` still points at the wrong IP, or Metro wasn't restarted after editing it. Redo step 4.            |
| Harness sends 0 pushes despite `PIVOT_EXPO_PUSH_TOKEN` being set | Token is stale (reinstall since capture) — redo step 5.                                                  |
| A fix you just made doesn't seem to take effect                  | Forgot to rebuild the changed `services/*` package — see the gotcha above.                               |
| Harness dies from a stray `Ctrl-C` in the wrong terminal         | Just restart step 8 with the same `--watch` list; the JSONL logs from before the kill are still on disk. |


