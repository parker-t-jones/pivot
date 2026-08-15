FANTASYFOCUS — LOCAL DEV STARTUP (iOS Simulator)
=================================================

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

3. API server (new tab)
   cd /Users/parkerjones/Developer/projects/fantasyfocus
   pnpm --filter @fantasy-focus/api dev
   # Wait for: "Server listening at http://127.0.0.1:3000"

4. Metro / Expo (new tab)
   cd /Users/parkerjones/Developer/projects/fantasyfocus/app
   pnpm start
   # Once the QR/menu appears, press: i
   # This opens the iOS Simulator and installs/launches the app.

5. Sign in on the simulator with your test account if prompted.


VERIFY THE BACKEND IS REACHABLE (optional sanity check)
---------------------------------------------------------
jwt
curl -s "http://127.0.0.1:3000/leagues" -H "Authorization: Bearer $JWT" | python3 -m json.tool


COMMON FIXES
------------
"Could not load your games" / red ErrorState on Home
  -> API server or Supabase isn't running. Redo steps 1-3, then tap Retry.

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