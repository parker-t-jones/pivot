# W9 — Cloudflare Pages for [app.pivot-sports.app](http://app.pivot-sports.app)

Tomorrow morning. Publish the web app from this repo (`parker-t-jones/pivot`, branch `main`). Do not use the marketing project `pivot-sports-site`. Do not build from `feature/betsync`.

Work from `~/Developer/projects/pivot-main-clean` on `main`. `EXPO_PUBLIC_*` is inlined at build time. A Pages runtime variable does nothing for a finished bundle, and uploading `app/.env` would bake in the phone's LAN addresses.

## 1. Create the project

Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → `parker-t-jones/pivot`.


| Setting                | Value                                           |
| ---------------------- | ----------------------------------------------- |
| Production branch      | `main`                                          |
| Root directory         | repository root (leave blank; do not set `app`) |
| Framework preset       | None                                            |
| Build command          | see below                                       |
| Build output directory | `app/dist`                                      |


Build command (the [WEB-PLAN](WEB-PLAN.md) export, with pnpm 9.15.0 activated first — that is the `packageManager` in `package.json`; Node 22 matches the Dockerfile):

```bash
corepack enable && corepack prepare pnpm@9.15.0 --activate && pnpm install --frozen-lockfile && pnpm --filter @pivot/app exec expo export -p web --output-dir dist
```

Environment variable (not an `EXPO_PUBLIC_` var): `NODE_VERSION` = `22`.

The export writes `app/dist/index.html`, `app/dist/_redirects`, and `app/dist/sw.js`. `_redirects` serves `/sw.js` as itself and sends every other path to `index.html`. Do not turn on a second single-page-application rewrite that would replace the service worker.

## 2. Build variables

Set these on the Production environment before the first real deploy. If a deploy already started, retry it after saving them.


| Variable                        | Production value                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `EXPO_PUBLIC_API_BASE_URL`      | `https://pivot-sports-api.fly.dev` (https, no trailing slash, no `/v1`)                                                                                                        |
| `EXPO_PUBLIC_SUPABASE_URL`      | `https://taucqrptzfyzhfzpinzo.supabase.co`                                                                                                                                     |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | The publishable anon key already in EAS production under this name. In `app/`: `eas env:list --environment production`. Not the service-role key. Not the value in `app/.env`. |
| `EXPO_PUBLIC_VAPID_PUBLIC_KEY`  | The public VAPID key only. Same string as Fly `VAPID_PUBLIC_KEY`: `fly ssh console -a pivot-sports-api -C 'printenv VAPID_PUBLIC_KEY'`.                                        |


Do not set any of these on the Pages project:

- `EXPO_PUBLIC_REVENUECAT_API_KEY`
- `EXPO_PUBLIC_SHARPSPORTS_PUBLIC_KEY`
- `SHARPSPORTS_PRIVATE_KEY`
- `VAPID_PRIVATE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

The private VAPID key stays a Fly secret. RevenueCat and SharpSports stay off the web build.

## 3. Custom domain and DNS

Do this on the new project only. If `app.pivot-sports.app` is already attached to `pivot-sports-site`, remove it there first. Do not publish `app/dist` from the marketing project.

1. Pages project → Custom domains → Set up a custom domain → `app.pivot-sports.app`.
2. If the zone is on this Cloudflare account, accept the record it offers to add. If it asks you to add the record yourself, create the CNAME in the table below at the DNS host for `pivot-sports.app`.
3. Confirm one record:


| Type  | Name  | Content                     | Proxy   |
| ----- | ----- | --------------------------- | ------- |
| CNAME | `app` | `<pages-project>.pages.dev` | Proxied |


1. Wait until the custom domain status is Active. HTTPS is issued by Cloudflare. Do not add an A record for `app`, and do not point `app` at the marketing site.

If the custom domain is not Active yet, open the `*.pages.dev` URL to confirm the build. The checks below are on `https://app.pivot-sports.app` once the certificate is Active.

## 4. Checks

1. **Load.** `https://app.pivot-sports.app` shows the Pivot app, not the marketing site. A refresh of a deep path (for example `/settings`) still returns the app, because `_redirects` rewrites it to `index.html`.
2. **Sign in.** Sign in with an existing account. If the hosted Supabase project requires email confirmation and the link fails, add `https://app.pivot-sports.app` to Authentication → URL configuration → Redirect URLs, then try again.
3. **Home loads.** After sign-in, Home renders the board. It is not a blank screen and not a stuck spinner.
4. **CORS.** DevTools console has no CORS errors. The signed-in `GET https://pivot-sports-api.fly.dev/me` response includes `access-control-allow-origin: https://app.pivot-sports.app`.
5. **Switch.** Press Switch on a game. A new tab opens to the https watch URL (YouTube TV is `https://tv.youtube.com/...`). The address is https, not `sportscenter://`.
6. **Upgrade sheet is read-only.** On a free account, Settings → Account → Upgrade to Pro. The sheet says `Pivot Pro is available in the iOS app`. It has Close. It has no Upgrade, Restore purchases, or Manage subscription button. On a Pro account the same sheet says `You're on Pro`. The sidebar card is a separate line (`Upgrade in the iOS app` or `You're on Pro`) and only navigates to Settings.

