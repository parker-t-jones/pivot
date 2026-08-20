FANTASYFOCUS — LOCAL DEV STARTUP
================================
Simulator path below. Physical iPhone: see "PHYSICAL DEVICE (iOS)" after Common Fixes.

ONE-TIME SETUP (skip if already done)
--------------------------------------
1. Add a JWT helper to your shell profile:
   nano ~/.zshrc
   
   Paste this function anywhere in the file:

   jwt() {
     export JWT=$(curl -s -X POST 'http://127.0.0.1:54321/auth/v1/token?grant_type=password' \
       -H "apikey: sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH" \
       -H "Content-Type: application/json" \
       -d '{"email":"parker.t.jones07@gmail.com","password":"test123"}' \
       | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
     echo "JWT set: ${JWT:0:20}..."
   }

   Save (Ctrl+O, Enter) and exit (Ctrl+X), then:
   source ~/.zshrc


EVERY SESSION — STARTUP ORDER
------------------------------
Run each step in its own terminal tab. Wait for each to be confirmed up
before starting the next.

1. Docker Desktop
   Open the Docker Desktop app manually. Wait until it shows "running."

2. Supabase (local)
   cd /Users/parkerjones/Developer/projects/fantasyfocus
   supabase start
   # Confirm it's up:
   supabase status

3. Seed reference data (required after first start, DB reset, or `supabase db reset`)
   cd /Users/parkerjones/Developer/projects/fantasyfocus
   pnpm seed:players    # Sleeper player dump → players (lineup sync resolves sleeper_id here)
   pnpm seed:schedule   # ESPN slate → games (phase openers / display_phase for /state/nfl)
   # Skip only if you already seeded this local DB and have not reset it.
   # Without these: Sleeper sync returns players_not_seeded; /state/nfl openers stay null
   # and display_phase falls back to unreliable Sleeper season_type (server warns in logs).

4. API server (new tab)
   cd /Users/parkerjones/Developer/projects/fantasyfocus
   pnpm --filter @fantasy-focus/api dev
   # Wait for: "Server listening at http://127.0.0.1:3000"

5. Metro / Expo (new tab)
   cd /Users/parkerjones/Developer/projects/fantasyfocus/app
   pnpm start
   # Once the QR/menu appears, press: i
   # This opens the iOS Simulator and installs/launches the app.

6. Sign in on the simulator with your test account if prompted.


VERIFY THE BACKEND IS REACHABLE (optional sanity check)
---------------------------------------------------------
jwt
curl -s "http://127.0.0.1:3000/leagues" -H "Authorization: Bearer $JWT" | python3 -m json.tool


COMMON FIXES
------------
"Could not load your games" / red ErrorState on Home
  -> API server or Supabase isn't running. Redo steps 1-2 and 4, then tap Retry.

Sleeper sync / connect lineup empty, or `players_not_seeded` (503)
  -> `players` table is empty. From repo root: `pnpm seed:players`, then POST /leagues/:id/sync.

`preseason_start` / `regular_season_start` null on GET /state/nfl
  -> `games` table is empty. From repo root: `pnpm seed:schedule`. Until then display_phase
     falls back to Sleeper season_type (API logs a warning on each /state/nfl call).

lsof -i :3000
  -> if empty, API server is down; if MULTIPLE pids, kill and restart clean:
     lsof -ti :3000 | xargs kill -9
     pnpm --filter @fantasy-focus/api dev

"Missing Authorization bearer token" on any curl
  -> your $JWT is empty or expired (~1hr). Just run: jwt

App stuck on "Could not connect to development server" after a --clear
  -> Metro needs a moment after a cold rebuild. Wait ~30-60s, then tap Reload
     in the simulator, or press i in the Metro terminal.

Full JS reset (stale bundle suspected)
  cd app
  pnpm start --clear
  # then fully quit the app in the simulator (swipe up in app switcher)
  # and press i in Metro to relaunch fresh

Full native rebuild needed (dev client missing / after Erase All Content)
  cd app
  pnpm expo run:ios
  # slow (several minutes) — only needed if the dev client itself is gone,
  # not for ordinary JS changes.


PHYSICAL DEVICE (iOS)
=====================
`app/ios/` is generated / gitignored — do not commit it. Re-run signing via
automatic provisioning when Xcode asks; the durable record of how is this section.

ONE-TIME (Mac + Apple Developer Program)
----------------------------------------
1. Xcode → Settings → Accounts → add Apple ID (paid team, not free Personal Team).
2. Manage Certificates → + → Apple Development.
3. If `security find-identity -v -p codesigning` shows the cert but "0 valid
   identities", the WWDR G3 intermediate is missing. Install:
     curl -fsSL -o /tmp/AppleWWDRCAG3.cer \
       https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer
     security add-certificates -k ~/Library/Keychains/login.keychain-db \
       /tmp/AppleWWDRCAG3.cer
4. Connect the iPhone by USB, Trust this computer, then:
   Settings → Privacy & Security → Developer Mode → On (restart + confirm).
5. First device build needs a provisioning profile with Push Notifications
   (`aps-environment`). Create it once with:
     cd app/ios
     xcodebuild -workspace FantasyFocus.xcworkspace -scheme FantasyFocus \
       -configuration Debug -destination 'id=<DEVICE_UDID>' \
       -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
   After that, `pnpm expo run:ios --device` can reuse the profile.
   Bundle ID: com.fantasyfocus.app  Team: LY2XMRG6VY (Parker Jones).

EVERY SESSION — DEVICE REACHABILITY
-----------------------------------
The phone cannot use 127.0.0.1. Point BOTH URLs in `app/.env` at a Mac address
the phone can route to, then restart Metro (`EXPO_PUBLIC_*` are inlined at
bundle time — a running Metro keeps the old values).

Prefer same Wi-Fi as the Mac:
  ipconfig getifaddr en0          # e.g. 192.168.12.24
  EXPO_PUBLIC_SUPABASE_URL=http://<en0-ip>:54321
  EXPO_PUBLIC_API_BASE_URL=http://<en0-ip>:3000
  Allow Local Network for FantasyFocus when iOS prompts.

If the phone is USB-only for development (`devicectl` transportType: wired)
and Wi-Fi times out, use the Mac's USB link-local IP (en8, 169.254.x.x) instead:
  ifconfig en8 | grep 'inet '
  REACT_NATIVE_PACKAGER_HOSTNAME=<en8-ip> pnpm expo start --dev-client
  # and set both EXPO_PUBLIC_* URLs to http://<en8-ip>:…
  Link-local addresses change when you unplug — switch back to Wi-Fi when you can.

BUILD / LAUNCH
--------------
  # UDID: xcrun xctrace list devices
  cd app
  pnpm expo run:ios --device <DEVICE_UDID>
  # or, after the native client is installed:
  REACT_NATIVE_PACKAGER_HOSTNAME=<mac-ip> pnpm expo start --dev-client

VERIFY (objective — not just "it opened")
----------------------------------------
- App process on device: FantasyFocus / com.fantasyfocus.app
- API log shows requests with remoteAddress = the phone (not 127.0.0.1 /
  the Mac's own IP). Over USB that is typically the 169.254 peer.
- Sign-in works; GET /leagues and GET /state/nfl return 200 from that address.
- On a real device after notification permission, Metro may log
  `[push] registering token via POST /me/push-token` and the API a 200 —
  that is B1 evidence, not required to call the B0 build gate green.

COMMON DEVICE FIXES
-------------------
"fetch failed: The request timed out" on sign-in
  -> Phone can't reach Supabase. Wrong .env host (still 127.0.0.1), Wi-Fi
     mismatch / client isolation, Local Network denied, or stale Metro still
     holding old EXPO_PUBLIC_* values. Fix .env, kill Metro on :8081, restart
     with --clear, relaunch the app.

"Developer Mode disabled" / destination unavailable
  -> Settings → Privacy & Security → Developer Mode. Restart is required.

"No profiles for 'com.fantasyfocus.app'"
  -> Expo omitted -allowProvisioningUpdates. Re-run the xcodebuild command
     in ONE-TIME step 5, then retry `pnpm expo run:ios --device`.

Signing identity exists but "0 valid identities found"
  -> Install AppleWWDRCAG3.cer (ONE-TIME step 3).