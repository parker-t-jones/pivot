### Saturday, Sept 26: accounts and keys (nothing goes live):

1. Install and sign in: brew install flyctl, then fly auth login.
2. Reserve the name: fly apps create pivot-api. If it's taken, pick another name and tell Cursor, since fly.toml and the webhook URL both use it.
3. Add a payment card in the Fly dashboard under Billing.
4. Check push: eas credentials -p ios. Confirm APNs key 82JW379P4C is attached to com.fantasyfocus.app.
5. Supabase: create a project in East US (North Virginia), free tier. Save the project URL, anon key, service_role key, JWT secret and database password in a password manager.
6. Upstash: create a free Redis database in the same region. Save its REST URL, REST token and TCP URL.
7. Webhook secret: run openssl rand -hex 32 and save the output as your RevenueCat webhook secret.
8. .env.production: create it at the path the runbook specifies and fill in the hosted values. It's gitignored; confirm with git status that it doesn't show up.



### Sunday, Sept 27 and Monday, Sept 28: game days. No Fly work.

- Sunday before 1pm: plug in, run recorder.sh start, and go do homework. Run status whenever you like. It stops itself after the last game.
- Monday before 8:15pm: same thing for Monday Night Football.



### Tuesday, Sept 29: database and deploy:

1. supabase link --project-ref . It asks for the database password. Don't edit config.toml.
2. supabase db push. Expect 10 migrations applied.
3. Apply supabase/seed.sql: paste it into the Supabase SQL editor and run it. Then select count(*) from teams; should return 32.
4. pnpm seed:players -- --env-file .env.production --allow-remote, then the same for seed:schedule. Never seed:broadcasts; the guard will refuse it anyway.
5. In the Supabase dashboard, under Authentication: email sign-in on, email confirmation off.
6. fly secrets set ... with the names from the runbook.
7. fly deploy, then fly scale count worker=1 (and api=1).
8. Smoke test:
- curl [https://pivot-api.fly.dev/health](https://pivot-api.fly.dev/health) should return {"ok":true,...};
- fly logs should show a [lineup-sync-worker] synced line within about 5 minutes.

### Wednesday, Sept 30: connect outside services:

1. RevenueCat: set the webhook URL to [https://pivot-api.fly.dev/billing/revenuecat](https://pivot-api.fly.dev/billing/revenuecat), with your secret as the auth header.
2. Expo dashboard: in both the preview and production environments, set EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY and EXPO_PUBLIC_API_BASE_URL.
3. Test build: build a preview version, install it on your phone, switch to cellular (Wi-Fi off), sign in, and confirm Home loads.

### Later, not scheduled yet:
- Upgrade Supabase to Pro before you invite outside TestFlight testers.
- Add the PUSH_DRIVER secret when P0 lands.
- No deploys on any Thursday, Sunday or Monday.
