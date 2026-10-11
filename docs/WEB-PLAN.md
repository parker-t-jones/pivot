# Web app plan — app.pivot-sports.app

Audit only. No app code was changed and nothing was committed. The Expo source is the sibling repo `parker-t-jones/pivot` (pnpm workspace, `@pivot/app`). This file is the plan for a browser build of that same app, hosted separately from the marketing site.

Frozen identifiers, left untouched and not proposed for change: bundle ID `com.fantasyfocus.app`, EAS slug `fantasy-focus`, Supabase `project_id` `FantasyFocusApp`.

## Decisions

Approved 2026-10-10. These override the audit's earlier recommendations where they disagree.

**Notifications.** Web Push plus in-tab alerts. There is no blanket 30-second client hold. Web timing matches iOS per event type, documented below. Routing nudges fire immediately: the ESPN-ahead-of-broadcast lead is the feature. Only a reveal-type alert would take spoiler-delay handling, and iOS does not delay any type today, so web does not invent one. No timing changes in `@pivot/dispatcher`.

**Presence.** One `active_users` slot per user becomes per device (`userId` + `deviceId` / platform). That slice is marked **TOUCHES iOS — on-device verification required, never deploy Fri–Mon.** It is not in the first batch.

**Purchases.** Web v1 has no purchase flow. The web UI shows Pro status read-only and says "Upgrade in the iOS app." That UI is a later slice. The entitlement check is not client-only, and it is not safe to rely on yet. See "Pro entitlement" below. That hole is a blocker for treating read-only status as enough.

**Layout v1.** Centered phone-width column (420px).

**Order.** Slices that cannot change iOS behavior come first: W1 web build and crash safety, W2 CORS, W3 switch, W4 hosting prep. Presence, Web Push, Settings, and the upgrade sheet wait.

Method: read the client, API, and dispatcher; ran `npx expo export -p web` from `app/` on 2026-10-10 (Node 22.20.0, pnpm 9.15.0, Expo SDK 56.0.12). The first run failed. A temporary install of the two missing packages let a second run finish. `app/package.json`, `pnpm-lock.yaml`, and the export directory were then restored. The hosted Supabase dashboard was not opened, and the Fly API was not called from a browser.

## Blockers

| Sev | Status | Blocker |
| --- | --- | --- |
| 1 | Confirmed, export failed | Web packages are not installed. `expo export -p web` exits before Metro with: install `react-dom@19.2.3` and `react-native-web@^0.21.2`. |
| 2 | Confirmed in source, not exercised in a browser | Auth storage is `expo-secure-store`, which declares platforms `apple` and `android` only. `getItemAsync` calls the native module. A web session cannot be read or written. |
| 3 | Confirmed, no CORS plugin in `services/api` | The Fly API (`https://pivot-sports-api.fly.dev`) has no CORS handling. A page on `app.pivot-sports.app` cannot `fetch` it. The `Authorization` header forces a preflight. |
| 4 | Confirmed in source | After sign-in, `NotificationResponseHandler` calls `Notifications.useLastNotificationResponse()`, which calls `getLastNotificationResponse()`. That throws `UnavailabilityError` on web inside `useLayoutEffect` and takes down the signed-in tree. `expo-notifications` platforms are `apple` and `android` only. |
| 5 | Confirmed in source | `/v1/realtime` writes one `active_users` member per user id. Connect marks the user active. Close calls `removeActiveUser`, which deletes that member even if another device is still connected. `decidePushDelivery` skips the push when the user is active and the flag's game is the stored primary. A laptop tab can suppress the iPhone push, and closing the tab can clear the phone's presence. |
| 6 | Confirmed in source | Push storage is one `users.expo_push_token` column. `POST /me/push-token` accepts only `platform: 'ios'` and only `ExponentPushToken[...]` / `ExpoPushToken[...]`. `DELETE /me/push-token` nulls that column. Web sign-out today calls that delete (`settings.tsx`). |
| 7 | Confirmed in source | The live channel cannot alert a hidden tab. `useHomeRealtime` stops the socket on `AppState` `background`. react-native-web maps a hidden document to `background`. The server also closes a socket that has not pinged in 40s, and background tabs throttle timers. |
| 8 | Confirmed in source | Switch will not reliably open YouTube TV. react-native-web `Linking.canOpenURL` resolves `true` for every URL, so ESPN https links are replaced with `sportscenter://watch`. Other https links go through `Linking.openURL`, which calls `window.open(..., '_blank')`, but only after the 700ms switching overlay and several awaits, which is outside the click turn and gets popup-blocked. |
| 9 | Confirmed in source | `isPurchasesConfigured()` is true whenever the RevenueCat env key is set, including on web. `configurePurchases` no-ops off iOS, then the upgrade sheet still calls `Purchases.getOfferings()`. |
| 10 | Confirmed, layout review | Screens are `flex: 1` with no desktop max width. A 1440px window stretches the phone UI edge to edge. |

The bundle itself is not a long-term blocker. After the two packages were installed, Metro finished in about 11s: 1111 modules, one JS bundle, one `index.html`. No Metro error. Node printed `NO_COLOR` / `FORCE_COLOR` warnings during startup. `pnpm add` also printed three unmet peers that are already in the SDK 56 tree (`@expo/dom-webview`, `react-native-worklets`, `@react-native/metro-config`). Those are not web compile failures.

## 1. Build

Command, from `app/`:

```bash
npx expo export -p web --output-dir /tmp/pivot-web-export-audit
```

First result, exit 1, before Metro:

```text
CommandError: It looks like you're trying to use web support but don't have the required
dependencies installed.

Install react-dom@19.2.3, react-native-web@^0.21.2 by running:

npx expo install react-dom react-native-web
```

Responsible files: `app/package.json` (no `react-dom`, no `react-native-web`). `app/app.json` has no `web` block. `@expo/metro-runtime` is already a dependency, which is what Expo's web runtime wants.

Second result, after a temporary `npx expo install react-dom react-native-web` (versions `react-dom@19.2.3`, `react-native-web@0.21.4`), exit 0:

- Expo loaded `app/.env` and inlined `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and `EXPO_PUBLIC_SUPABASE_URL`. Those values are the local-device ones, not production.
- Output was a single-page shell: `index.html` (root `#root` plus one deferred script) and `_expo/static/js/web/entry-*.js` (2.9MB). `metadata.json` listed no per-route HTML. Direct loads of `/lineup` will 404 unless the host rewrites them to `index.html`.
- Fonts from `@expo-google-fonts/jetbrains-mono`, `plus-jakarta-sans`, and `space-grotesk` were emitted. `expo-router` assets were emitted.
- `react-native-purchases`, `expo-notifications`, `expo-secure-store`, and `expo-haptics` bundled. They fail at call time, not at bundle time.
- `expo-dev-client` is a dependency and an `app.json` plugin, and it is not imported by app JS, so it was not a bundle error. Its module config is apple/android only.

Nothing in that export was kept.

## 2. Dependencies

No `react-native-svg`, Reanimated, Lottie, or `expo-blur`. `FieldGauge` is plain `View`s with percentage `left` and a red-zone fill (`app/components/FieldGauge.tsx`). That renders on react-native-web. Shadows in `theme.ts` use RN `shadow*` props, which react-native-web maps to `box-shadow`. `useNativeDriver: true` (banner slide, switch overlay) falls back to the JS driver and warns.

| Module | Where | Web support | Fallback |
| --- | --- | --- | --- |
| `expo-secure-store` 56.0.4 | `app/lib/supabase.ts`, `app/lib/pushNotifications.ts` | None. Platforms `apple`, `android`. | Web auth adapter that uses `localStorage`. Push-token cache is irrelevant on web if Web Push is stored server-side. |
| `expo-notifications` 56.0.20 | Banner host, response handler, push permission, push registration, dev test notification | None. Platforms `apple`, `android`. `getPermissionsAsync`, `requestPermissionsAsync`, `getLastNotificationResponse`, `scheduleNotificationAsync`, and `getExpoPushTokenAsync` throw `UnavailabilityError`. `setNotificationHandler` does not throw just for being called. | Do not call these on web. In-tab banner from the existing websocket. Web Push via the browser Push API. |
| `expo-haptics` 56.0.3 | `FlagEventBanner` `impactAsync` | None. Platforms `apple`, `android`. The call is `void`'d, so it is an unhandled rejection, not a render crash. | Skip on web. Play a short sound instead when the tab is visible. |
| `expo-device` 56.0.4 | `pushNotifications.ts` `Device.isDevice` | Module config includes `web`. | Registration already returns early when this is false. Web should not call `getExpoPushTokenAsync` at all. |
| `expo-linking` | Dependency of the SDK / router. App switch code imports `Linking` from `react-native`, not from `expo-linking`. | The JS API works. | Use the react-native-web behavior below, with a web-specific open. |
| `react-native` `Linking` | `SwitchingContext`, Settings, Upgrade sheet | `canOpenURL()` resolves `true` with no argument check. `openURL(url)` with one argument calls `window.open(url, '_blank', 'noopener')`. There is no `openSettings`. | Web: open the https watch URL in a new tab from the click turn. Hide "open Settings". |
| `react-native-purchases` 10.10.0 | `app/lib/purchases.ts`, `UpgradeSheet` | Native module. The package bundled. `configure` is already skipped when `Platform.OS !== 'ios'`. | On web, treat purchases as unconfigured even if the env key is present. Pro stays an iOS purchase. The server tier still comes from `GET /me` (`subscription_tier`), which the RevenueCat webhook writes. |
| `react-native-screens` `FullWindowOverlay` | `NotificationBannerHost` | On non-iOS it `console.warn`s and returns a plain `View`. It does not crash. | That View is enough for an in-tab banner. |
| `react-native-safe-area-context` | Most screens | Works. Insets are 0 in a desktop browser. | No change. |
| `expo-font` / `@expo-google-fonts/*` | `app/lib/fonts.ts`, root layout | Works. The export emitted the font files. | No change. |
| `expo-router` 56.2.11 | All screens | Works. This export was a client-rendered SPA, not per-route HTML. | Host rewrite to `index.html`. |
| `expo-constants` | Push project id, Settings version | Works for `expoConfig`. | No change. |
| `expo-status-bar` | Transitive, not a screen dependency in the files reviewed | No-op on web. | No change. |
| `react-native-url-polyfill` | `app/lib/supabase.ts` | Harmless. Browsers already have `URL`. | Leave the import. It is a no-op where `URL` exists. |
| AirPlay (`app/modules/airplay-route`) | Optional native module, platforms `apple` only | `requireOptionalNativeModule` returns null. The controller falls back to `unavailableAirPlayRouteController`. Production `resolveSwitch` does not put AirPlay in the registry. | No web work. |
| `expo-dev-client` | Native dev client only | Not in the JS graph. | Do not load it on web. |

Project rule in the app repo: do not use `localStorage`. That rule is why iOS uses SecureStore. Web session persistence has to be a `Platform.OS === 'web'` branch. The iOS branch stays SecureStore.

## 3. Auth

Sign-in and sign-up are email and password through `supabase.auth.signInWithPassword` / `signUp` (`app/app/(auth)/sign-in.tsx`, `sign-up.tsx`). There is no magic link, no Supabase OAuth provider, and no PKCE redirect in the client. `detectSessionInUrl` is `false`, which matches that flow.

Session persistence today:

```15:27:app/lib/supabase.ts
const secureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
```

On web those three methods reject, so `getSession()` fails, the root layout never leaves "Loading session...", and a successful password sign-in cannot be stored. The web adapter should be `localStorage` (supabase-js's usual browser storage). Keep `detectSessionInUrl: false` unless email-confirmation links are later pointed at this origin.

Sign-up immediately calls `signInWithPassword`. If the hosted project requires email confirmation, that second call fails until the user confirms. Local `supabase/config.toml` has `site_url = "http://127.0.0.1:3000"` and `additional_redirect_urls = ["https://127.0.0.1:3000"]`. The hosted dashboard was not inspected. If confirmation mail is on, the hosted redirect allow-list has to include `https://app.pivot-sports.app`. That is a dashboard setting, not a code change to `project_id`.

Sleeper is not OAuth. Connect is a username: `GET /sleeper/leagues?username=` then `POST /leagues/sleeper` with `sleeper_username` (`app/lib/leagues.ts`, `app/app/(app)/connect-team.tsx`). No Sleeper redirect URI exists, so none needs to change for the current product. A future Sleeper OAuth would be new work and would need `https://app.pivot-sports.app/...` on Sleeper's allow-list.

## 4. Notifications

Expo push does not deliver to browsers. The phone path is: dispatcher builds a title/body, publishes `flag_event` on `realtime:user:{id}`, then maybe sends one Expo push to `users.expo_push_token`. The in-app banner is not driven by that socket. `NotificationBannerHost` listens only to `Notifications.addNotificationReceivedListener`. Home uses the socket to update the board (`useHomeRealtime` → `homeFlagUpdates`).

Fire time is "now". `QueueingEventDispatcher` sets `scheduledFireAt` to the clock and does not add lag. `lagSecondsFor` is a ranking tiebreak. YouTube TV's table value is 30 seconds (`shared/src/broadcast/lag.ts`), measured as how far YouTube TV sits behind ESPN. Copy is not outcome-free. Title is like "Jonathan Taylor active". Body is like "Colts have the ball — Q2, 7:14. Tap to watch." (`notificationContent.ts`). Shown on time with ESPN, that is about 30 seconds ahead of the YouTube TV picture on the same laptop.

`decidePushDelivery` skips the push when Redis says the user is active and the flag game is the primary. "Active" is the socket, and there is only one slot per user.

### (a) Web Push beside APNs

A service worker on `app.pivot-sports.app`, VAPID keys, and `PushManager.subscribe`. The dispatcher sends Web Push in addition to Expo, to a new subscription row (endpoint, p256dh, auth). It must not write `users.expo_push_token`.

Safari on macOS: Safari 16.1+ on macOS 13+ implements the standard Push API and delivers it through APNs. A notification can show when the Pivot tab is in the background, and Apple delivers these through the system, so Safari does not have to be the frontmost app. macOS does not require Add to Home Screen (that requirement is iOS and iPadOS). Permission is per origin, must follow a click, and needs HTTPS plus a service worker. Chrome, Edge, and Firefox on macOS also support Web Push; their browser process has to be running. This is weaker than APNs-to-the-phone: a force-quit browser is a worse bet than a force-quit iOS app, and a denied permission has no OS Settings deep link (`Linking.openSettings` is absent).

Dispatcher and storage: new table, new route, second sender next to `ExpoPushNotifier`. `POST /me/push-token` stays iOS-only. Web sign-out deletes that browser's subscription only. `hasToken` becomes per channel. The Expo payload and the Expo send time stay as they are.

### (b) In-tab only

Sound and `FlagEventBanner` while the document is visible, fed by the `flag_event` the socket already delivers. No new token, no service worker.

This misses the actual session. The user is watching in another window. Hiding the Pivot tab sets `AppState` to `background`, which stops the socket. A background tab would also miss the 40s ping budget. An in-tab banner on a covered tab is invisible, and a sound from a hidden tab is easy for the browser to drop.

### (c) Both — approved

In-tab banner and sound when Pivot is the focused tab. Web Push when it is hidden or closed. One of the two, not both at once, for a given event. The laptop case is a covered Pivot tab and a YouTube TV window; only an OS notification lands on that window. In-tab matches the phone's foreground banner when Pivot itself is focused.

Do not hold either surface for `lagSecondsFor`. That 30-second YouTube TV figure is a ranking tiebreak (`shared/src/broadcast/lag.ts`, used by `expandWatchOptions`). `QueueingEventDispatcher` overwrites `scheduledFireAt` with the clock and says `lagSecondsFor` is not a delay (`services/dispatcher/src/scheduleFlagEvent.ts`). Web must not add a delay the phone does not have.

### How iOS treats each event type

Event union: `flag_added | flag_removed | priority_increased | priority_decreased | bet_in_play` (`shared/src/engine/types.ts`). Every type that is queued is scheduled at "now". None of them wait for broadcast lag.

| Type | What iOS does | When | Spoiler delay? |
| --- | --- | --- | --- |
| `flag_added` | Push plus realtime. Title names who is active ("Jonathan Taylor active", "3 of your players active", "Broncos defense on the field"). Body is possession and clock, or the red-zone line (`notificationContent.ts`). This is the routing nudge. `decideAction` may say switch, in-app indicator, or (Pro) add-to-split. | Immediate. Push-eligible (`collapseFlagEvents.ts`). Dropped before delivery by quiet hours, `notificationMode` `off` / `high_leverage_only`, or 3-per-60s (`rateLimiter.ts` returns early only for non-eligible types). | No |
| `bet_in_play` | Push plus realtime. Title `Your {label} is in play`. Body `Tap to switch.` Outcome-free routing nudge (`notificationContent.ts`). Collapses with a fantasy flag in the same window; a tie prefers `flag_added` (`collapseFlagEvents.ts`). | Immediate. Same push gates as `flag_added`. | No |
| `priority_increased` | Realtime only. Home board updates. Not a push (`isPushEligibleEvent` is false). `shouldRateLimit` returns false, so quiet hours and the rate limit do not drop it. | Immediate publish. | No |
| `priority_decreased` | Same as `priority_increased`: socket only, not a push. | Immediate publish. | No |
| `flag_removed` | Realtime only. Title is past tense ("no longer active"). Body is "Possession changed" (`notificationContent.ts`). `decideAction` returns `notify_only` / `dismiss` (`decideAction.ts`). Not a push. | Immediate publish. | No |

`delivery.ts` publishes the socket envelope for every delivered event, then sends Expo only when `isPushEligibleEvent` is true. The comment above that check still says "only flag_added"; the code includes `bet_in_play`.

"Reveal" in the dispatcher is not a delayed second notification. `collapseFlagEvents.ts` uses it for "one push-eligible event per user per pass." `pushRetry.ts` drops a failed push retry after 2 minutes (`PUSH_RELEVANCE_MS`). `resumptionWatcher.ts` can hold flags during a stoppage until the next real play or a 4-minute ceiling (`RESUMPTION_CEILING_MS`). That is "don't alert on a timeout," not "wait until YouTube TV catches up." None of it is a per-type spoiler delay, and none of it changes for web.

When Web Push and the in-tab banner are built, they fire on the same events, at the same time, as the iOS push and the iOS foreground banner. No new hold.

Presence is per connection, grouped by device. The design and the call-site list are in "W5 — presence per connection" below. **TOUCHES iOS — on-device verification required. Deploy Tue–Thu only, never Fri–Mon, and in a separate deploy from the grant-lock migrations.** A current TestFlight build sends no device info and keeps today's behavior. The web client opens `/v1/realtime` once that deploy is live.

## 5. Switch and deep links

Watch URLs are already https. YouTube TV is `https://tv.youtube.com/search/{Away} vs {Home} today` (`shared/src/broadcast/watchLinks.ts`). Sunday Ticket uses the same host with `NFL ST` in the query. Prime, DirecTV, and the other services are https landings or searches. The only custom scheme the client adds is `sportscenter://watch`, and only for `https://www.espn.com/...` (`app/lib/watchLink.ts`).

On web, `selectWatchLink` asks `Linking.canOpenURL` before accepting a scheme. react-native-web's `canOpenURL` resolves `true` unconditionally, so an ESPN game opens `sportscenter://watch` and never falls through to https. A YouTube TV game has no scheme, so the https URL is chosen, then `Linking.openURL` requests a new tab. The call sits after `MIN_OVERLAY_MS` (700) and the session `PUT`, so it is not in the click turn. Safari and Chrome block that `window.open`.

Web behavior to add, without changing the iOS order: ignore custom schemes; open the https URL with `window.open` created synchronously on the Switch press, then set that window's location when the URL is known. `tv.youtube.com/search/...` then loads in a new tab. Same-tab navigation would unload Pivot.

"Get app" still points at `apps.apple.com` search URLs (`app/lib/streamingServices.ts`). On web those are a new tab to the App Store, which is acceptable. They are not a web player.

## 6. Layout

v1 should be a centered phone-width column (about 420px) on the existing dark background, applied once at the web root. The UI spec, type scale, `FieldGauge`, board rows, and tab bar are designed as a phone. There is no breakpoint system. `maxWidth` shows up on the switch error card (380) and a couple of chips, not on screens. A responsive Home and Lineup is a redesign, not a port.

The column is web-only. iOS already has a phone-width window.

| Screen | Route | Readiness | At desktop width |
| --- | --- | --- | --- |
| Welcome | `/welcome` | minor fix | Already a centered stack. The column stops the title line from growing to the monitor. Needs working session storage so the root redirect can leave it. |
| Sign in | `/sign-in` | minor fix | Same centered card. `KeyboardAvoidingView` already uses padding on iOS only. |
| Sign up | `/sign-up` | minor fix | Same as sign in. Confirmation-email behavior depends on the hosted project, not on layout. |
| Home | `/` | minor fix | Header, live hero, `FieldGauge`, and the board are full-bleed phone compositions. Inside a 420px column they match the phone. The gauge is Views, so it does not need a new renderer. Pull-to-refresh is a weak desktop gesture; a refresh control can wait. The alert behavior is the notification section, not this layout. |
| Lineup | `/lineup` | minor fix | Slot column, player rows, and opponent rows are phone density. A wide window turns each row into a long empty gap. The column fixes that. No native module. |
| Settings | `/settings` | needs rework | The scroll of sections is fine in the column. The section is not: test notification calls `expo-notifications`, "open Settings" calls `Linking.openSettings` (missing on web), sign-out deletes the only Expo token, and "manage subscription" opens Apple's account page. Privacy is `https://pivot-sports.app/privacy` while the marketing site file is `/privacy.html`. Terms is `https://pivot-sports.app/terms` and that page does not exist in this repo. |
| Connect team | `/connect-team` | minor fix | Username form, league list, manual picker. No OAuth redirect UI. Fine in the column. |
| Edit manual lineup | `/edit-manual-lineup` | minor fix | Form and list. Fine in the column. |
| Add stake | `/add-stake` | minor fix | Form. Fine in the column. |
| Notifications permission | `/notifications-permission` | needs rework | Copy and the button are the iOS prompt. On web, `getPermissionsAsync` throws, the context catches it and stores `denied`, and the gate only redirects here when status is `undetermined`, so the screen is skipped. If it is opened anyway, Enable throws. Replace with the Web Push permission request, or skip it until W7. |
| Onboarding streaming | `/onboarding-streaming` | minor fix | Service blocks use `minWidth: '47%'`. That is a two-column wrap inside the phone column and a sparse wrap on a full monitor. The column is enough. |
| All set | `/onboarding-all-set` | minor fix | Centered. Fine in the column. |
| Upgrade sheet | modal, not a route | needs rework | `Modal` works on web. The body calls RevenueCat and links to Apple subscriptions. On web, say Pro is purchased in the iOS app and keep showing `subscription_tier` from `GET /me`. |

## 7. Backend

`services/api/src/server.ts` registers routes and `@fastify/websocket`. It does not register `@fastify/cors`, and nothing else in `services/api/src` sets `Access-Control-Allow-Origin`. Browser `fetch` from `https://app.pivot-sports.app` to `https://pivot-sports-api.fly.dev` fails the OPTIONS preflight because of `Authorization` and `Content-Type: application/json`. Native clients do not send that preflight.

Allow list, not `*`: `https://app.pivot-sports.app`, plus the Pages preview origin used for branch deploys, plus local web dev (`http://localhost:8081` or whatever port `expo start --web` prints). Allow methods GET, POST, PUT, PATCH, DELETE, OPTIONS and headers `Authorization`, `Content-Type`. Do not set `Access-Control-Allow-Credentials` unless cookies are added. The client uses a bearer token.

WebSocket: the browser sends `Origin` on the upgrade. This server does not check it, so the socket can connect once the page has a JWT. CORS does not cover WebSocket. The presence bug in blocker 5 is the real socket issue.

Mobile-only API assumptions:

- `POST /me/push-token` rejects every platform except `ios` (`unsupported_platform`) and rejects any token that is not an Expo push token.
- One `expo_push_token` per user. A second device overwrites the first. Web must not use this column.
- `DELETE /me/push-token` clears the phone token. Web sign-out must not call it.
- `active_users` is one member per user id, deleted on any socket close.
- Billing is a RevenueCat webhook (`POST /billing/revenuecat`) that sets `users.subscription_tier`. Web v1 does not start a purchase. See "Pro entitlement."
- Watch URLs and league routes are plain JSON. They are not mobile-only.
- `GET /v1/realtime?token=` puts the JWT in the query string. That is the existing design. On web it will also show up in server logs and proxy logs. Not a new leak relative to the phone, and not something to redesign in the first slice.

## 8. Hosting

The marketing site stays `pivot-sports.app`. This repo is already a Cloudflare Pages project (`wrangler.jsonc` name `pivot-sports-site`, assets directory `.`). The app needs a second Pages project and the hostname `app.pivot-sports.app`. Do not publish the Expo `dist` from this marketing repo, or a marketing deploy and an app deploy will fight over one project.

Build, from the app repo, with production env present in the Pages build environment:

```bash
pnpm install --frozen-lockfile
pnpm --filter @pivot/app exec expo export -p web --output-dir dist
```

Publish `app/dist`. `EXPO_PUBLIC_*` is inlined at bundle time. Pages runtime env does nothing for a finished static bundle. Set, as build variables, the same values EAS production already uses: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and `EXPO_PUBLIC_API_BASE_URL=https://pivot-sports-api.fly.dev` (https, no trailing slash, no `/v1`). Do not upload `app/.env`. That file is the phone's LAN addresses, and the audit export inlined it. Omit `EXPO_PUBLIC_REVENUECAT_API_KEY` on web so the upgrade sheet does not try StoreKit. `VAPID` public key, when W7 exists, is also an `EXPO_PUBLIC_` build variable. The private key stays a Fly secret on the dispatcher, not a Pages variable.

SPA fallback: this export emits only `/index.html`. Add a Pages `_redirects` of `/* /index.html 200` in the published output (or the equivalent single-page-application setting). Cache the hashed `/_expo/static/js/web/entry-*.js` for a long time. Cache `index.html` briefly so a new deploy is picked up.

`app.json` `scheme` is `pivot`. That is the iOS URL scheme. It is not the web origin.

## Deploy

Second Cloudflare Pages project, hostname `app.pivot-sports.app`. Do not publish this from the marketing project (`pivot-sports-site`). Create the Pages project by hand. These are the settings.

Build command, from the app repo root:

```bash
pnpm install --frozen-lockfile
pnpm --filter @pivot/app exec expo export -p web --output-dir dist
```

Output directory: `app/dist`.

SPA fallback: `app/public/_redirects` lists `/sw.js /sw.js 200` before `/* /index.html 200`, so the service worker is not rewritten to `index.html`. Expo copies both `sw.js` and `_redirects` into the export root. Cache `/_expo/static/js/web/entry-*.js` for a long time. Cache `index.html` briefly. Do not cache `sw.js` for long.

`EXPO_PUBLIC_*` is inlined at build time. Set these as Pages build variables. Do not upload `app/.env`. That file is the local stack (`http://127.0.0.1:54321` and `:3000`).

| Variable | Production value |
| --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | `https://pivot-sports-api.fly.dev` (https, no trailing slash, no `/v1`) |
| `EXPO_PUBLIC_SUPABASE_URL` | `https://taucqrptzfyzhfzpinzo.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | The publishable anon key already stored in EAS production under this name. Not the service-role key. Not the value in `app/.env`. |
| `EXPO_PUBLIC_VAPID_PUBLIC_KEY` | The public VAPID key, a Pages build variable. The browser uses it for `PushManager.subscribe`. |

Do not set `EXPO_PUBLIC_REVENUECAT_API_KEY` on the web build.

Web Push signing keys are Fly secrets on the API, not Pages variables. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT=mailto:support@pivot-sports.app`. The private key never goes in the web bundle. After that deploy, `curl -sS https://pivot-sports-api.fly.dev/health` must include `"webPush":"enabled"`. `"disabled"` means a secret is missing. The API and the runner each log `Web Push disabled: missing VAPID_PRIVATE_KEY` (one line per missing variable) at startup. Locally, the three names go in `services/api/.env.local`, and the public key goes in `app/.env.local` as `EXPO_PUBLIC_VAPID_PUBLIC_KEY`. Both files are gitignored. The API loads `.env.local` after `.env` and does not let it override a variable already set. In-tab alerts use the API's existing `/v1/realtime` socket. They do not use Supabase Realtime. `web_push_subscriptions` is service_role-only, same as the grant lock in `20261010195000` and `20261010201000`. `WEB_DEV_ORIGIN` is an API env var on Fly, not an `EXPO_PUBLIC_` var. Leave it empty in production. The production web origin is allowed without it.

CORS on `https://pivot-sports-api.fly.dev` is still the old process until that API deploy. The Pages build will not fix preflight by itself.

## Pro entitlement

Web v1 shows status and does not sell Pro. That is safe only if a browser session cannot grant itself Pro.

The API does enforce the free caps. It reads `users.subscription_tier` and rejects the write:

- Connecting a fourth league: `assertCanConnectLeague` in `services/api/src/routes/leagues.ts` throws `403 league_limit_free` unless the tier is `pro` (`FREE_MAX_LEAGUES` is 3).
- Watching a second league: `PATCH` preferences in `services/api/src/routes/me.ts` throws `403 watched_league_limit_free` (`FREE_MAX_WATCHED_LEAGUES` is 1).
- A manual lineup over 9 players: the lineup `PUT` in `services/api/src/routes/leagues.ts` throws `403 manual_lineup_limit_free`.
- After a disconnect, `onLeagueDisconnected` in `services/api/src/lib/watched-leagues.ts` slices a free user's watched list back to one.
- Flag CTAs: `decideAction` in `services/dispatcher/src/decideAction.ts` returns `add_to_split` only when `subscriptionTier === 'pro'`. `GET /flags/current` passes the column into that function.

The app client never writes `subscription_tier`. The only app writer is the RevenueCat webhook, `POST /billing/revenuecat` in `services/api/src/routes/billing.ts`, using the service role.

The column is still client-writable. Migration `supabase/migrations/20260510120000_users_user_app_presence.sql` enables RLS, then `users_update_own` lets `authenticated` `UPDATE` their own row with no column list, and `GRANT UPDATE ON public.users TO authenticated` is unrestricted. No later migration revokes that. The web bundle ships the anon key and a Supabase client, so a signed-in browser can `update({ subscription_tier: 'pro' })` and every check above will honor it. The iOS app has the same policy today; the web client makes the call trivial from devtools.

This is a blocker for "read-only status is enough." The caps are server-side, but the bit they trust is not. Closing it means a column privilege or a trigger that ignores client updates to `subscription_tier`, with the webhook still writing through the service role. That is not part of W1–W4. Do not ship the upgrade-sheet copy as if the tier were locked.

## Implementation slices

Slices that cannot change iOS behavior are W1–W4 and are the ones to build first. Later slices are listed so the 30-second hold and the single presence slot are not the plan anymore.

### W1 — Web build and crash safety

No iOS behavior change. Add `react-dom` and `react-native-web`. Session storage stays `expo-secure-store` on native and uses `localStorage` on web. Guard `expo-notifications` so `getLastNotificationResponse` does not run on web. Centered 420px column on web only.

- Before: `npx expo export -p web` from `app/` exits 1 with the missing-dependency error.
- After: export exits 0. Sign-in persists across reload. Home's shell renders. iOS still uses SecureStore, still mounts `NotificationResponseHandler`, still requests notification permission.

### W2 — CORS

No iOS behavior change. Allow `https://app.pivot-sports.app` and `WEB_DEV_ORIGIN` (env, not hardcoded). Allow `Authorization` and preflight. Requests with no `Origin` (the phone) are unchanged.

- Before: an OPTIONS preflight from the web origin has no `Access-Control-Allow-Origin`.
- After: that preflight echoes the allowed origin. A different origin does not. A request with no `Origin` still returns 200.

### W3 — Switch on web

No iOS behavior change. On web, do not call `Linking.canOpenURL` and do not use `sportscenter://`. `window.open` the https URL inside the click, before the 700ms overlay. Native `selectWatchLink` order stays.

- Before: ESPN https becomes `sportscenter://watch` because web `canOpenURL` is always true, and YouTube TV opens after the overlay.
- After: a YouTube TV press opens `https://tv.youtube.com/search/...` in a new tab in the click turn. An ESPN press opens the https URL. iOS still tries `sportscenter://watch` first.

### W4 — Hosting prep

Config only. `app/public/_redirects` is the SPA fallback, and Expo copies it into `app/dist`. Build command, output directory, and `EXPO_PUBLIC_*` production values are under "Deploy." The Pages project itself is created by hand.

### W6 — Web Push and in-tab alerts

Same event types and the same timing as the table above. No dispatcher delay. Web Push is a second sender beside Expo and must not write `users.expo_push_token`. A hidden web tab stays connected and does not count as active, so a Web Push can reach it.

In-tab alerts use the API's existing socket (`GET /v1/realtime`). They do not use Supabase Realtime. The schema stays service_role-only (`20261010195000`, `20261010201000`). `web_push_subscriptions` grants nothing to `anon` or `authenticated`. Deploy Tue–Thu only, never Fri–Mon, and only after W5 is live in production.

While the tab is visible, `flag_added` and `bet_in_play` show `FlagEventBanner` from the socket's `notification` field (title and body, outside `payload`). A service-worker `postMessage` for an event the socket already delivered is dropped by event id, so the banner shows once. Switch uses the same click-time `window.open` as the watch handoff. Alert sound is a web-only Settings toggle, stored in `localStorage` under `pivot.alert-sound`, default on. A hidden tab does not show the banner; the system notification covers it.

Fan-out uses the same title and body, and the same quiet-hours, mode, collapse, and push-retry gates, as the Expo send. A subscription is skipped only when that `deviceId` has a live visible connection and the flag's game is the primary. The rate limit records the event once. Headers are Urgency `high`, TTL 60 seconds, and Topic equal to the collapse key (the user id as 32 URL-safe characters). A 404 or 410 deletes that row. A success writes `last_success_at`. Web failures are not queued on the iOS push-retry path.

### W5 — presence per connection

**TOUCHES iOS — on-device verification required. Deploy Tue–Thu only, never Fri–Mon, and separately from the grant-lock migrations.**

What the code did before this slice: `active_users` held one sorted-set member per user id. The score is an expiry timestamp, `Date.now() + ttlMs` (`ACTIVE_USER_TTL_MS` is 5 minutes). A member is live while `score >= now`. `sweepExpiredActiveUsers` runs `zremrangebyscore active_users 0 <now-1>` and has no production caller. `GET /v1/realtime` called `markUserActive(user.id)` on connect and on ping, and `removeActiveUser(user.id)` on every socket close. `decidePushDelivery` skipped the push for the whole user when that member was live and the flag's game was the stored primary. The primary is one row per user, `viewing_sessions.primary_game_id`.

Push tokens: one column, `users.expo_push_token`. A user has one iOS token. `POST /me/push-token` overwrites it. `DELETE /me/push-token` nulls it. The dispatcher reads it in `SupabaseUserDirectory.getUser` and sends it when `decidePushDelivery` returns `sent`.

Sockets: the iOS app connects only while `AppState` is `active`. `background` calls `client.stop()`, which closes the socket and removes the member immediately. `inactive` (Control Center) does not. A hidden web tab used to take the same path, because react-native-web reports a hidden document as `background`.

Device identity: the client generates a random UUID once (iOS: SecureStore key `pivot.device-id`; web: `localStorage`, try/catch) and sends `deviceId` and `platform` (`ios` or `web`) on the realtime URL. The id is stored under the authenticated user, so it cannot name another user's presence. The server accepts only a UUID. `legacy-ios` is reserved and is not a valid client id.

Legacy: a connection with no `deviceId`, and with `platform` omitted or `ios`, is the current TestFlight client. It still calls `markUserActive(user.id)` and `removeActiveUser(user.id)`. The Redis member stays the bare user id, scored the same way. That member is device `legacy-ios`. A push token posted without `deviceId` is stored with `expo_push_device_id` null, which means `legacy-ios`. A web connection with no `deviceId` is rejected with HTTP 400 before the upgrade.

New connections: one sorted set per user, `presence:{userId}`. The member is `{deviceId}|{connectionId}|{platform}`, scored by the same expiry. Every write runs `ZREMRANGEBYSCORE` on that key from 0 to `now-1`, then writes, then `PEXPIRE`s the key to the TTL. Lookups read only that key, plus a `ZSCORE` of the legacy member. Visibility is a separate hash, `presence-vis:{userId}`, field `{connectionId}`. The hash is written before the sorted-set member and gets the same `PEXPIRE`. A hidden web connection does not count. iOS has no hidden state: background still closes the socket. Ping refreshes only that connection. Close removes only that connection. A device is active when any of its connections counts. A user is active when the legacy member is live or any device counts. When the last connection is removed, both keys are deleted. An unclean disconnect leaves a member until the next write prunes it or the key's `PEXPIRE` elapses.

`POST /me/push-token` takes an optional `deviceId` and writes `users.expo_push_device_id`. The new iOS build posts that `deviceId` on every launch, including when the token string is unchanged, so an upgrade fills a null column. The column is on `public.users`, which already has no privileges for `anon` or `authenticated`. The migration grants nothing new. `service_role` still writes the row. `publicGrants` must keep passing.

`decidePushDelivery` is unchanged for a given `connected` flag. Delivery now passes that flag from the token's device only: suppress the device when that device is active and the flag's game is the user's primary. One legacy iOS connection therefore produces the same result as today. Primary stays per user.

Call sites:

| Call site | Decision | Why |
| --- | --- | --- |
| `realtime.ts` connect, ping, close | Per connection. No `deviceId` keeps `markUserActive` / `removeActiveUser`. | Old clients keep the bare user-id member. A new socket must not delete another connection. |
| `session.ts` `POST /session/heartbeat` | User-level legacy member. | The app does not call it. The route has no device id, and it still means "this user is present," which counts as `legacy-ios` for the push decision. |
| `delivery.ts` `isUserActive` → `decideAction` | User-level: any counting device, including the legacy member. Hidden web does not count. | One `flag_events` row and one socket envelope per user. Push suppression is a separate, per-device decision. |
| `delivery.ts` `decidePushDelivery` | Per device, using `expo_push_device_id` or `legacy-ios`. | A laptop must not suppress the phone's token. |
| `getActiveUsers` | User-level unique ids. | No production engine caller. A user with two live connections is returned once. Hidden-only web users are omitted. |
| `sweepExpiredActiveUsers` | Legacy `active_users` only. | No production caller. A per-user presence key prunes expired members on its next write and disappears on `PEXPIRE`. |
| `experiments/diagnose-live-flags.ts`, `experiments/live-sunday-harness.ts` | Still `markUserActive(userId)`. | Those scripts are the legacy slot. |
| `isStillRelevant` | Does not read `active_users`. | An open socket was never a gate on whether the event is delivered. |

The public web client sends `deviceId`, `platform=web`, and `visible` / `hidden` on `visibilitychange`. That client is safe to ship once this slice is deployed. Until the deploy, a build that opens the socket against the old server would still use the old user-level key, so this ships with the server, not before it.

### Later — Settings and the upgrade sheet

Not started. Settings still calls `expo-notifications`, `Linking.openSettings`, and `DELETE /me/push-token`. The upgrade sheet still calls RevenueCat when the env key is set. Web copy is "Upgrade in the iOS app" and a read-only tier, after the entitlement blocker above is closed. iOS purchase and restore stay on RevenueCat.
