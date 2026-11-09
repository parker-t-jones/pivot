# EAS Update runbook

How JS-only fixes reach installed iPhones without an App Store review. Parker runs every command here. Claude sessions never run `eas update` (or any `eas` command). They say in the PR whether the change is update-safe or needs a build.

**First, the prerequisite.** Updates only reach builds that include `expo-updates`. The first such build is the one after the PR that added this runbook. Until it is live on the App Store, no device can receive an update.

## How it is wired

- `app/app.json`
  - `updates.url` points at project `63e2ba9a-dc24-48cc-af2b-dc2c27014634`.
  - `runtimeVersion` uses `{ "policy": "fingerprint" }`. That is a hash of the native layer, so an update only lands on builds whose native code matches it.
- `app/eas.json`: `production` builds listen on the `production` channel and `preview` builds on `preview`. `screenshots` extends `production`, so it inherits that channel too.
- On launch the app checks for an update in the background (`checkAutomatically: ON_LOAD`, `fallbackToCacheTimeout: 0`). It never waits for that check: it starts on the bundle it already has.
  - A downloaded update applies on the **next cold start**, not mid-session.
  - There is no in-app "update now" prompt, and no app code calls `reloadAsync` (`scripts/easUpdate.test.ts` pins that).
- Settings → About shows which bundle the device runs (see "Which update a device runs").

## Update or build?

An update ships only the JS bundle and its assets. Anything else needs an `eas build` and an App Store submission.

| Change                                                                                                             | Ship as                                                   |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Copy, layout, styles, JS logic in `app/` or `@pivot/shared`                                                        | Update                                                    |
| Images, fonts, or other assets imported from JS                                                                    | Update                                                    |
| Bumping a JS-only npm package                                                                                      | Update, if the runtime version is unchanged (check below) |
| Adding, removing, or bumping any package with native code (`expo-*`, `react-native-*`, `react-native-purchases`)   | Build                                                     |
| Anything in `app/modules/*/ios`                                                                                    | Build                                                     |
| `app.json` native fields: plugins, `ios.*`, `infoPlist`, entitlements, associated domains, icon, scheme, `version` | Build                                                     |
| Expo SDK or React Native upgrade                                                                                   | Build                                                     |
| `app/eas.json` (it is part of the fingerprint)                                                                     | Build, or a no-op update that reaches no one              |
| Backend-only (`services/`, `supabase/`)                                                                            | Neither. Fly deploy                                       |
| Web only                                                                                                           | Neither. Pages deploys on merge to `main`                 |

The fingerprint decides, not the table. Before publishing, compare the runtime of the code you are about to ship with the runtime of the live build:

```bash
cd app && npx expo-updates runtimeversion:resolve --platform ios | head -c 200
```

The live build's runtime is shown on its page in the EAS dashboard (Builds → the build → Runtime version). If the two differ, the update would go to a runtime no installed build has. It reaches nobody, so ship a build instead.

### What the fingerprint does and does not see in this monorepo

This was checked against the repo when the policy was chosen. The fingerprint **does** change when:

- a native package is added, removed, or changes version. The pnpm store path, which carries the version, is in the autolinking config it hashes.
- `app/modules/airplay-route/ios` changes.
- `app.json`, `eas.json`, the app icon, or `app/package.json` scripts change.

It does **not** change for:

- JS in `app/` or `@pivot/shared`
- `EXPO_PUBLIC_*` values
- local `.env` files

What it does **not** hash is the contents of third-party native packages. pnpm installs them under `node_modules/.pnpm/<pkg>/node_modules/<pkg>`, which matches `@expo/fingerprint`'s default ignore `**/node_modules/**/node_modules/**`. So an in-place edit to a package's native source, without a version change, would be missed.

Nothing in this repo does that today: there are no `patchedDependencies`, and a `pnpm patch` would rename the store path anyway, so the hash would still change. Don't hand-edit files under `node_modules`.

The fingerprint is computed from the installed `node_modules`. Run `pnpm install --frozen-lockfile` before resolving or publishing, or your local runtime may not match the build's.

## Publish

`EXPO_PUBLIC_*` values are inlined into the bundle when it is built. A bundle exported with `app/.env` would ship local URLs to every iPhone. Always publish with the wrapper:

```bash
git checkout main && git pull && pnpm install --frozen-lockfile
```

```bash
pnpm update:ios --message "Fix the Watchlist header copy."
```

The wrapper (`scripts/easUpdate.ts`) runs three steps:

1. `eas env:exec production '… export'` exports the iOS bundle into `app/dist-update/` (gitignored) using the EAS **production** environment.
   - Local `app/.env*` files are ignored (`EXPO_NO_DOTENV=1`).
   - It refuses before exporting unless `EXPO_PUBLIC_API_BASE_URL` is exactly `https://pivot-sports-api.fly.dev`.
2. It refuses unless the exported bundle contains `https://pivot-sports-api.fly.dev`. No app source hardcodes that URL (pinned by a test), so the bundle only contains it if the production env value was inlined.
3. It uploads that exact export:

   ```bash
   eas update --channel production --environment production --platform ios --skip-bundler --input-dir dist-update --message "…" --non-interactive
   ```

If you ever run `eas update` by hand, it must carry `--environment production`. Without it, `eas update` bundles with whatever env your shell and `app/.env*` provide. The wrapper is the only path with the URL check.

`eas update` itself refuses to run on a dirty git tree. Publish from a clean `main` at the commit you mean to ship.

Timing follows the CLAUDE.md game-day rules for client releases: not during live games.

After publishing:

1. Force-quit the app on a production install and open it. That launch downloads the update.
2. Force-quit and open the app again. The update is now running.
3. Check Settings → About.

## Which update a device runs

Settings → About, under "Pivot v{version}", shows one of:

- "Running the version that shipped with this build." The device runs the build's embedded bundle: no update has landed yet, or the channel was rolled back to embedded.
- "Running update 0f1e2d3c from the production channel." The first 8 characters of the iOS update ID.

Match the ID against the update group in the EAS dashboard (Updates → production branch → the group → iOS update ID), or list recent groups:

```bash
cd app && eas update:list --branch production
```

```bash
cd app && eas update:view <group-id>
```

The line does not appear on web, in development builds, or in Expo Go.

## Roll back

Devices pick up a rollback the same way as an update: on the next launch they download it, and it runs from the cold start after that.

**Republish the previous good update.** Find the previous group ID with `eas update:list --branch production`, then:

```bash
cd app && eas update:republish --group <previous-group-id> --message "Roll back to <previous-group-id>."
```

**Or roll back to the bundle embedded in the build.** Use the runtime version of the live build:

```bash
cd app && eas update:roll-back-to-embedded --channel production --runtime-version <runtime-version> --platform ios --message "Roll back to the embedded bundle."
```

Neither command re-bundles, so neither needs the API URL check. Both reuse a bundle that already passed it or shipped in the build.

## Verified, and not

- Command flags were read from the eas-cli 27.5.0 source, not run. `eas.json` allows `>= 21.0.0`. If your global `eas` is older and `env:exec` or `--environment` is missing, upgrade it (`npm i -g eas-cli`).
- The fingerprint behavior above was measured locally with `npx expo-updates runtimeversion:resolve --platform ios`. It is the same resolver EAS Build uses.
