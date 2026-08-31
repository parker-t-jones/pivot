# UI Visual Polish — Audit Pass

Read-only inventory of the Pivot Expo client (`app/`). No code was changed for this pass. Scope is visual surfaces: screens under `app/app/`, components under `app/components/`, and overlay UI in `app/contexts/SwitchingContext.tsx` / `app/app/_layout.tsx`. Test fixtures, API payloads, and NFL team colors flowing from the server are called out only where they paint UI.

Apple HIG 44×44 pt is the yardstick for “undersized” touch targets. Measurements are from style numbers (padding + font size), not from a simulator.

---

## 1. Hardcoded design values

### 1.0 Theme / tokens file

**Location:** `app/lib/theme.ts` (only tokens module; no `tokens.ts`, `colors.ts`, `spacing.ts`, or `typography.ts`).

PLAN.md Known Issues records a completed migration onto this file (amber accent `#FFB020`, dark base, type scale). That write-up claims the only remaining hex literals are team colors from server data. That claim is **stale**: root-session chrome still uses `#444`, and several components hardcode `rgba(...)` overlays derived from accent/danger/black.

Every visual screen/component except the two unthemed root loaders imports `theme` from this file.

**What it covers today** (`app/lib/theme.ts`):

| Bucket | Tokens | Lines |
| --- | --- | --- |
| Colors | `background`, `surface`, `surfaceRaised`, `border`, `textPrimary` / `Secondary` / `Tertiary`, `accent`, `accentPressed`, `onAccent`, `danger`, `success` | 6–19 |
| Spacing | `xs` 4, `sm` 8, `md` 12, `lg` 16, `xl` 24, `xxl` 32 | 20–27 |
| Radii | `sm` 8, `md` 12, `lg` 16, `pill` 999 | 28–33 |
| Type | `title` 26/600, `heading` 20/600, `body` 15/400, `bodyStrong` 15/500, `caption` 13/400 — **size + weight only, no lineHeight** | 34–40 |

**Defined but unused in any component style:**

- `theme.colors.accentPressed` — defined at `app/lib/theme.ts:15`; grep finds **zero** style/press-state uses. No `onPressIn` / pressed overlay anywhere.
- `theme.colors.success` — defined at `app/lib/theme.ts:18`; unused.

**Not in the scale, widely used anyway:**

- Line heights (20 / 21 / 23)
- Letter-spacing (0.3 / 0.4 / 0.6 / 1)
- Font sizes 12, 14, 16, 22 (none of these are on the type scale)
- Font weight `'700'` (scale tops out at `'600'`)
- Spacing 2, 6, 7, 10, 13, 14, 15, 18, 20, 22, 40, 48 (20 is the most common bypass — between `lg` 16 and `xl` 24)
- Radius `10` and `20` (between `sm`/`md`, and beyond `lg`)
- Overlay/scrim colors, accent-tint, danger-tint
- Shadow / elevation
- Disabled opacity
- Control min-height / touch-target size
- Border width (1 vs 2 vs `hairlineWidth`)

There is no light theme, no React context, and no press-state wiring for the unused `accentPressed` token.

---

### 1.1 Raw hex / rgb / rgba in component styles

These are literals in `StyleSheet` / inline style, **not** `theme.colors.*`. Team colors applied from API data are listed separately.

| File | Line(s) | Value | What it paints |
| --- | --- | --- | --- |
| `app/app/_layout.tsx` | 80 | `'#444'` | Session/redirect loading text. Matches the marketing site’s tagline color (`pivot-sports.app` CSS `p.tagline { color: #444 }`), **not** `theme.colors.textTertiary` (`#6E6E78`). This file also does not set `backgroundColor` on the loader. |
| `app/components/NowActiveCard.tsx` | 134 | `'rgba(255, 176, 32, 0.18)'` | Reason-chip fill. 255,176,32 is `theme.colors.accent` (`#FFB020`) at 18% opacity — no `accentMuted` token. |
| `app/app/(app)/settings.tsx` | 816 | `'rgba(255, 90, 90, 0.14)'` | Disconnect chip fill. 255,90,90 is `theme.colors.danger` (`#FF5A5A`) at 14% opacity — no `dangerMuted` token. |
| `app/components/FlagEventBanner.tsx` | 99 | `'rgba(0, 0, 0, 0.35)'` | Banner backdrop scrim. |
| `app/contexts/SwitchingContext.tsx` | 425 | `'rgba(0, 0, 0, 0.72)'` | Switch overlay scrim. |

**Not counted as hardcoded brand colors (data-driven):**

- `app/contexts/SwitchingContext.tsx:245` — `backgroundColor: colors.primary`, `borderColor: colors.secondary` on the team-color flash. Values come from the flag/game payload, not the theme file.

**Unthemed platform defaults (no hex, still untokened):**

- `app/app/_layout.tsx:11` and `app/app/index.tsx:12` — `ActivityIndicator` with no `color`. iOS default gray on an unstyled (likely light) view.
- `app/app/(app)/_layout.tsx:19` — local `LoadingState` spinner has no `color` (the wrapper **does** use `theme.colors.background` at line 139).
- All `Switch` controls in Settings (`app/app/(app)/settings.tsx:337–341`, `350–352`, `386–399`, `577–591`) — no `trackColor` / `thumbColor`. On iOS the on-state is system green, not amber.

No other `#hex` or `rgb()` literals appear in `app/**/*.tsx` component styles. `theme.ts` itself is the token source, not a bypass.

---

### 1.2 Magic-number spacing / padding / margin / gap / radius

Values below are numeric literals, **not** `theme.spacing.*` / `theme.radii.*`. `insets.top + theme.spacing.*` is tokened (not listed). `width: '100%'` / flex percentages omitted.

#### Layout chrome / screens

| File | Line(s) | Property | Value |
| --- | --- | --- | --- |
| `app/app/_layout.tsx` | 75, 77 | `gap`, `paddingHorizontal` | 12, 24 (12 = `md`, 24 = `xl`, both written raw; this file does not import `theme`) |
| `app/app/(app)/_layout.tsx` | 147 | `fontSize` only in type section; spacing here **is** tokened | — |
| `app/app/(auth)/welcome.tsx` | 52 | `paddingVertical` | 14 |
| `app/app/(auth)/sign-in.tsx` | 125, 145 | `paddingHorizontal`, `paddingVertical` | 20, 10 |
| `app/app/(auth)/sign-up.tsx` | 153, 173 | `paddingHorizontal`, `paddingVertical` | 20, 10 |
| `app/app/(app)/index.tsx` | 435, 450 | `paddingHorizontal`, `paddingVertical` | 20, 6 |
| `app/app/(app)/connect-team.tsx` | 279, 282, 286, 289, 295, 299, 314, 315, 329, 330 | `paddingHorizontal` / `borderRadius` / `paddingHorizontal` / `paddingVertical` / `borderRadius` | 20, 20, **radius 10**, 14, **radius 10**, 14, **radius 10**, 14, **radius 10**, 14 |
| `app/app/(app)/edit-manual-lineup.tsx` | 142 | `paddingHorizontal` | 20 |
| `app/app/(app)/onboarding-streaming.tsx` | 55, 104, 124, 129, 131 | `paddingTop`/`paddingBottom` (inline), `paddingVertical`, `gap`, `borderRadius`, `paddingVertical` | 48, 48, 10, 10, **radius 10**, 14 |
| `app/app/(app)/notifications-permission.tsx` | 64, 72 | `paddingVertical`, `gap` | 14, 14 |
| `app/app/(app)/onboarding-all-set.tsx` | 37, 39, 47 | `borderRadius`, `paddingVertical`, `gap` | **10**, 14, 14 |
| `app/app/(app)/settings.tsx` | 686–688, 693, 704, 707, 719, 730, 735, 745, 754, 773–774, 801, 804, 812–813 | `gap`/`paddingBottom`/`paddingHorizontal`, `paddingVertical`, `paddingHorizontal`, `width`, `paddingVertical`, `gap`, `marginTop`, `marginTop`, `gap`, `borderRadius`/`marginTop`, `borderRadius`, `marginBottom`, `paddingHorizontal`/`paddingVertical` | 20, 48, 20, 10, 20, 48, 10, 2, 6, 2, 6, **radius 10**, 10, **radius 10**, 10, 10, 6 |

#### Shared components / overlays

| File | Line(s) | Property | Value |
| --- | --- | --- | --- |
| `app/components/LoadingState.tsx` | 32, 33 | `gap`, `paddingVertical` | 10, 40 (`inline` variant — currently unused by callers) |
| `app/components/EmptyState.tsx` | 54, 65, 67, 68, 79 | `paddingVertical`, `borderRadius`, `minWidth`, `paddingVertical`, `marginTop` | 40, **10**, 200, 13, 2 |
| `app/components/ErrorState.tsx` | 31, 32, 42 | `paddingHorizontal`, `paddingVertical`, `paddingVertical` | 20, 10, 40 |
| `app/components/NowActiveCard.tsx` | 92–94, 102, 137 | `borderRadius`, `gap`, `padding`, `paddingVertical`, `paddingVertical` | **20**, 10, 20, 15, 6 |
| `app/components/PlayerPicker.tsx` | 129, 133, 136, 142, 146, 161, 162, 178 | `paddingHorizontal`, `borderRadius`, `paddingHorizontal`, `borderRadius`, `paddingHorizontal`, `borderRadius`, `paddingVertical`, `maxHeight` | 20, **10**, 14, **10**, 14, **10**, 14, 180 |
| `app/components/FlagEventBanner.tsx` | 70, 94, 95, 115, 117 | inline `paddingTop` extra, `gap`, `marginTop`, `shadowOffset.height`, `shadowRadius` | 12, 10, 14, 4, 10 |
| `app/contexts/SwitchingContext.tsx` | 357, 360–361, 366–367, 395, 408 | `borderRadius`, `paddingHorizontal`/`Vertical`, `paddingHorizontal`/`Vertical`, `marginTop`, `padding` | **10**, 14/10, 14/**7**, 18, 22 |

**Also numeric but arguably not “spacing” (listed for completeness):**

- `IdleHomeCard.tsx:63` — divider `height: 1`
- `FlagEventBanner.tsx:109` — `elevation: 8`
- `SwitchingContext.tsx:389, 410` — `borderWidth: 2`, `maxWidth: 380`
- `sign-in.tsx:141` / `sign-up.tsx:169` — `borderWidth: 1`
- `PlayerPicker.tsx:165` — `opacity: 0.5` disabled (no disabled-opacity token)

**Uncertain:** several literals equal a token (`12` = `spacing.md`, `24` = `spacing.xl`, `16` = `spacing.lg`) but are written raw. Treated as bypasses because they are not referenced from the scale. `borderRadius: 10` is consistently used as an unofficial fifth radius (between `sm` 8 and `md` 12) on connect-team, PlayerPicker, EmptyState primary, streaming Continue, all-set, settings secondary/segmented control, and switching broadcast rows.

---

### 1.3 Inline `fontSize` / `fontWeight` / `lineHeight` not from `theme.type`

Type scale sizes are **13, 15, 20, 26**. Weights are **400, 500, 600**. There is **no** lineHeight on the scale. Any `'700'`, size 12/14/16/22, or `lineHeight` is a bypass. Using `theme.type.body.size` (15) with `fontWeight: '600'` is also a bypass of `body.weight` (`'400'`) / `bodyStrong.weight` (`'500'`).

#### Sizes and weights that ignore the scale entirely

| File | Line(s) | Values |
| --- | --- | --- |
| `app/app/_layout.tsx` | 81 | `fontSize: 16` (no theme import) |
| `app/app/(app)/_layout.tsx` | 147 | `fontSize: 16` on loading text (color is tokened) |
| `app/app/(auth)/welcome.tsx` | 44–45, 56–57, 72–73, 79, 85 | size 16 + lineHeight 23; size 16 weight `'700'`; size 14 weight `'700'`; size 14; weight `'600'` |
| `app/app/(auth)/sign-in.tsx` | 113–114, 129, 133, 143, 149, 153 | size 16 weight `'600'`; size 14; size 14; size 16; weight `'600'`; size 15 (equals `body.size` but literal) |
| `app/app/(auth)/sign-up.tsx` | 141–142, 157, 161, 171, 177, 181 | same pattern as sign-in |
| `app/app/(app)/index.tsx` | 455 | `fontWeight: '600'` on Settings link (size is `body.size`) |
| `app/app/(app)/connect-team.tsx` | 274, 288, 309, 319–320, 334–335, 339 | size 16; size 16; weight `'600'`; size 16 weight `'700'`; size 16 weight `'600'`; size 14 |
| `app/app/(app)/edit-manual-lineup.tsx` | 138 | size 16 (Back) |
| `app/app/(app)/onboarding-streaming.tsx` | 111–112, 135–136, 144, 151–152 | size 14 weight `'600'`; size 16 weight `'700'`; size 14; size 14 lineHeight 20 |
| `app/app/(app)/notifications-permission.tsx` | 57, 68–69 | lineHeight 21 (size/weight tokened); size 16 weight `'600'` |
| `app/app/(app)/onboarding-all-set.tsx` | 32, 43–44 | lineHeight 21; size 16 weight `'700'` |
| `app/app/(app)/settings.tsx` | 683, 697–698, 734, 740, 759, 764–766, 780, 794, 821, 826 | size 16; size 14 weight `'600'`; size 14; weight `'600'`; size 12; size 12 weight `'700'` + letterSpacing 0.6; weight `'600'`; weight `'600'`; weight `'600'`; weight `'600'` |
| `app/components/EmptyState.tsx` | 58–59, 73, 77–78 | size 14 lineHeight 20; weight `'700'`; size 14 weight `'600'` |
| `app/components/ErrorState.tsx` | 37, 46 | weight `'600'`; size 14 |
| `app/components/NowActiveCard.tsx` | 109–110, 117–119, 142, 146–147 | size 16 weight `'700'`; size 12 weight `'700'` + letterSpacing 1; weight `'600'`; size 22 weight `'700'` |
| `app/components/PlayerPicker.tsx` | 135, 156, 169–170, 175, 182–183, 195 | size 16; weight `'600'`; size 16 weight `'700'`; weight `'600'`; size 12 weight `'700'`; size 14 |
| `app/components/FlagEventBanner.tsx` | 103, 129, 141, 145–146 | size 14; weight `'600'`; weight `'600'`; size 16 weight `'700'` |
| `app/components/IdleHomeCard.tsx` | 52, 70–71 | lineHeight 21; weight `'600'` + letterSpacing 0.4 |
| `app/components/HomeOffDayCard.tsx` | 49, 61 | lineHeight 21; weight `'600'` + letterSpacing 0.4 |
| `app/components/HomePregameCard.tsx` | 48–49, 67, 87–88 | weight `'600'` + letterSpacing 0.4; lineHeight 21; weight `'600'` + letterSpacing 0.3 |
| `app/components/HomeLiveIdleCard.tsx` | 69, 96–97 | lineHeight 21; weight `'600'` + letterSpacing 0.3 |
| `app/contexts/SwitchingContext.tsx` | 375, 380, 385, 402, 415 | weight `'700'`; weight `'700'`; weight `'600'`; weight `'600'`; lineHeight 21 |

**Honest uses of the type scale** (size *and* weight from `theme.type.*`): titles on most screens; `IdleHomeCard` heading/body/leagueLine; `HomeOffDayCard` heading/matchup; `HomePregameCard` / `HomeLiveIdleCard` hero titles and some row type; `EmptyState` title; `ErrorState` button text size (weight still `'600'` vs `body.weight`).

**Eyebrow pattern is untokened and inconsistent:**

- Welcome: size 14, weight `'700'`, letterSpacing 1, accent (`welcome.tsx:70–75`)
- Now active: size 12, weight `'700'`, letterSpacing 1, `textSecondary` (`NowActiveCard.tsx:115–120`)
- Idle / pregame / off-day: `caption.size` (13), weight `'600'`, letterSpacing 0.4, accent
- Settings section titles: size 12, weight `'700'`, letterSpacing 0.6 (`settings.tsx:762–768`)
- PlayerPicker roster heading: size 12, weight `'700'`, no letterSpacing (`PlayerPicker.tsx:180–185`)

---

## 2. Shared component inventory

There is **no** shared `Button`, `Card`, `ListRow`, or `TextInput` component. Shared visual primitives that do exist: `LoadingState`, `EmptyState`, `ErrorState`, `PlayerPicker`, plus Home-state cards (`NowActiveCard`, `HomeLiveIdleCard`, `HomePregameCard`, `HomeOffDayCard`, `IdleHomeCard`) and `FlagEventBanner`.

`EmptyState.tsx:19–23` claims it covers “Settings' empty Leagues list” and “onboarding's connect-team prompt”. **That docstring is stale.** Settings empty leagues is muted `rowSubtext` (`settings.tsx:454–455`). Connect-team choose-provider is a custom title + two buttons (`connect-team.tsx:85–99`). The only `EmptyState` call site is Home State 5 (`index.tsx:349–360`).

### 2.1 Buttons

| Variant | Visual recipe | Used on | Duplicates / drift |
| --- | --- | --- | --- |
| **A. Primary amber, radius `sm` (8), padV `md` (12)** | accent fill, `onAccent` label, size 16 weight `'600'` | Sign-in (`sign-in.tsx:105–115`), sign-up (`sign-up.tsx:133–143`), notifications Enable (`notifications-permission.tsx:59–70`), ErrorState Retry (`ErrorState.tsx:28–38`, padH 20 extra) | Closest thing to a “default” primary. Welcome is the same radius but padV **14** and weight `'700'`. |
| **B. Primary amber, radius `sm` (8), padV 14, weight `'700'`** | otherwise like A | Welcome Get started (`welcome.tsx:47–58`) | One-off vs A. |
| **C. Primary amber, radius 10, padV 14, weight `'700'`** | unofficial radius | Connect-team (`connect-team.tsx:311–321`), streaming Continue (`onboarding-streaming.tsx:126–137`), all-set (`onboarding-all-set.tsx:34–45`), PlayerPicker save (`PlayerPicker.tsx:158–171`) | Four copies of the same unofficial recipe. PlayerPicker adds `opacity: 0.5` when empty (`:164–166`). |
| **D. Primary amber, radius `md` (12), padV 15, weight `'700'`** | slightly taller | NowActiveCard Watch CTA (`NowActiveCard.tsx:97–114`); disabled swaps fill to `border` | Only Home State 1. Disabled is a fifth primary look (gray fill, `textPrimary` label). |
| **E. Primary amber, radius 10, padV 13, minWidth 200, weight `'700'`** | centered, constrained width | EmptyState (`EmptyState.tsx:62–74`) | Drift from C: 13 vs 14 pad, extra minWidth, `body.size` (15) vs 16. |
| **F. Secondary filled, radius 10, padV 14, surface, `textPrimary` weight `'600'`** | | Connect-team “Add manually” (`connect-team.tsx:326–336`) | |
| **G. Secondary filled, radius 10, padV `md`, `surfaceRaised`** | | Settings Sign out / Connect another (`settings.tsx:770–781`) | Same radius as F, different fill (`surfaceRaised` vs `surface`) and pad (12 vs 14). |
| **H. Text-only accent** | no hit-area padding (or tiny) | Welcome “Sign in” link (`welcome.tsx:83–86`); Home Settings (`index.tsx:448–456`, padV 6); connect-team Close (`connect-team.tsx:69–71`, 272–275); edit-lineup Back (`edit-manual-lineup.tsx:99–107`, 136–139); Settings Close (`settings.tsx:678–684`, padV `xs`); Settings About links (`settings.tsx:732–736`); streaming Skip (`onboarding-streaming.tsx:89–94`, 142–148); EmptyState secondary (`EmptyState.tsx:40–44`, 75–80, underlined `textSecondary` not accent) | Many one-offs. EmptyState secondary is underlined muted text, not accent. |
| **I. Text-only danger** | no fill | Settings Delete account (`settings.tsx:690–699`, padV 10); PlayerPicker Remove (`PlayerPicker.tsx:101–103`, 172–176) | Delete has padV 10; Remove is caption-sized text only. |
| **J. Small chip, `surfaceRaised`, radius `sm`, padH 10 / padV 6, caption `'600'`** | | Settings league Sync / Edit / Rename (`settings.tsx:807–827`) | Danger sibling J′ uses `rgba(255,90,90,0.14)` (`:815–821`). |
| **K. Segmented control** | track radius 10, active segment accent, caption `'600'` | Settings notification mode (`settings.tsx:782–806`) | Unique. |
| **L. Streaming pill chips** | `radii.pill`, padH `lg` / padV 10; selected = accent + `onAccent` | Onboarding streaming (`onboarding-streaming.tsx:100–116`) | Settings streaming uses **switches**, not chips (`settings.tsx:383–401`) — same data, two UIs. |
| **M. Banner pair** | Dismiss = `surfaceRaised` radius `sm` padV `md`; Switch = accent same shape | `FlagEventBanner.tsx:119–142` | Closest to a two-button dialog pattern; not reused. |
| **N. Compact overlay actions** | accent, radius `sm`, padH 14 / **padV 7**, caption `'700'` | Switching “Watch” (`SwitchingContext.tsx:363–376`); “Get app” is same size on `border` fill (`:369–381`) | Smallest filled buttons in the app. |
| **O. Overlay full-width Close** | accent, radius `sm`, padV `md`, marginTop 18 | Switching error (`SwitchingContext.tsx:391–403`) | Same as A with extra top margin. |

No component uses `theme.colors.accentPressed` on press.

### 2.2 Cards

| Variant | Recipe | Used on | Drift |
| --- | --- | --- | --- |
| **Home panel** | `surface`, `radii.lg` (16), pad `lg`, gap `md` | `IdleHomeCard.tsx:54–59`, `HomeOffDayCard.tsx:51–56`, live-idle / pregame **hero** (`HomeLiveIdleCard.tsx:60–65`, `HomePregameCard.tsx:58–63`) | Consistent. |
| **Home nested row** | `surface`, `radii.md` (12), pad `md` | Live game rows (`HomeLiveIdleCard.tsx:54–58`), pregame game blocks (`HomePregameCard.tsx:52–57`) | |
| **Now-active hero** | `surface`, **radius 20**, **pad 20**, **gap 10** | `NowActiveCard.tsx:90–96` | Only card off the radius/spacing scale. Spec calls this the “large, dominant” card — likely intentional, still untokened. |
| **Settings section** | `surface`, `radii.lg`, pad `lg`, **gap 6** | `settings.tsx:751–756` | Gap 6 not on scale. |
| **In-app banner** | `surface`, `radii.lg`, shadow/elevation, inset top padding | `FlagEventBanner.tsx:106–118` | Only elevated surface. |
| **Switch error sheet** | `surface`, `radii.lg`, pad **22**, maxWidth 380 | `SwitchingContext.tsx:404–411` | Pad 22 not on scale. Switching *in-progress* card (`:430–436`) has **no** surface fill — spinner + text on the scrim. |
| **Auth / onboarding “card”** | `View` with gap, **no** surface, no radius | Welcome (`welcome.tsx:59–62`), sign-in/up (`sign-in.tsx:116–118`), notifications (`notifications-permission.tsx:71–74`), all-set (`onboarding-all-set.tsx:46–48`) | Content sits directly on `background`. Uncertain whether intentional (editorial) or unfinished. |

### 2.3 List rows

| Variant | Recipe | Used on | Drift |
| --- | --- | --- | --- |
| **Tappable surface row** | `surface`, radius 10, padH 14, padV `md`, space-between | Connect-team Sleeper leagues (`connect-team.tsx:292–310`); PlayerPicker search hits (`PlayerPicker.tsx:139–157`) | **Near-duplicate styles** (even the style key is `leagueOption` in PlayerPicker). |
| **Roster row** | no fill, padV `sm`, Remove text on the right | `PlayerPicker.tsx:187–192` | |
| **Settings league row** | hairline top border (`surfaceRaised`), padV 10, actions wrap | `settings.tsx:714–727` | Not a card; denser than connect-team rows. |
| **Settings toggle row** | space-between, padV `sm` | Notifications quiet hours, streaming services, star players (`settings.tsx:828–833`) | |
| **Broadcast alternate row** | `surface`, radius 10, padH 14, padV 10 | `SwitchingContext.tsx:354–362` | Same unofficial radius 10 as connect-team rows; padV 10 vs `md` (12). |

Home “list” of live/pregame games is the nested-row **card** variant above, not a list-row primitive.

### 2.4 Text inputs

| Variant | Recipe | Used on | Drift |
| --- | --- | --- | --- |
| **Auth field** | `surface` + **1px `border`**, `radii.sm` (8), padH `md`, padV **10**, fontSize **16**, placeholder `textTertiary` | Sign-in (`sign-in.tsx:61–80`, 137–146), sign-up (`sign-up.tsx:78–109`, 165–174) | Two copy-pasted StyleSheets. |
| **Connect / picker field** | `surface`, **no border**, radius **10**, padH **14**, padV `md`, fontSize **16**, placeholder `textSecondary` | Connect-team username + league name (`connect-team.tsx:149–156`, 238–244, 284–291); PlayerPicker search (`PlayerPicker.tsx:67–73`, 131–138) | Placeholder token differs from auth (`textSecondary` vs `textTertiary`). Radius 10 vs 8. No border vs border. |
| **System prompt** | iOS `Alert.prompt` | Settings rename league (`settings.tsx:424–449`) | Not styled by the app. |

No shared `TextInput` wrapper; no error-border variant (errors are sibling text / `ErrorState`).

### 2.5 Undersized touch targets (eyeball from styles)

HIG 44 pt. Approximate height ≈ vertical padding × 2 + font size.

| Control | File:line | Why it looks small |
| --- | --- | --- |
| Home **Settings** | `index.tsx:448–450` | padV 6 + body 15 ≈ **27 pt**; padH only `sm` (8) |
| Settings **Close** | `settings.tsx:678–680` | padV `xs` (4) + size 16 ≈ **24 pt** |
| Connect-team **Close** | `connect-team.tsx:69–71` | `Pressable` wrapping 16 pt text, **no** padding style |
| Edit-lineup **Back** | `edit-manual-lineup.tsx:99–107` | Same as Close: text only |
| Settings league **Sync / Edit / Rename / Disconnect** | `settings.tsx:807–813` | padV 6 + caption 13 ≈ **25 pt** |
| Switching **Watch / Get app** | `SwitchingContext.tsx:363–367` | padV **7** + caption 13 ≈ **27 pt** |
| Now-active **reason chip** | `NowActiveCard.tsx:132–137` | padV 6 + caption 13 ≈ **25 pt** (display chip; not a primary control) |
| Streaming **Skip for now** | `onboarding-streaming.tsx:89–94` | underlined 14 pt text, no padding |
| Settings **About links** / test notification | `settings.tsx:641–672`, 732–736 | 14 pt text, `marginTop: 6`, no padding |
| EmptyState **secondary** | `EmptyState.tsx:40–44` | underlined 14 pt, `marginTop: 2` |
| PlayerPicker **Remove** | `PlayerPicker.tsx:101–103` | caption text, no padding |
| Settings **Delete account** | `settings.tsx:690–693` | padV 10 + size 14 ≈ **34 pt** (short of 44) |
| ErrorState **Retry** | `ErrorState.tsx:31–32` | padV 10 + body 15 ≈ **35 pt** |
| Auth **TextInputs** | `sign-in.tsx:145` padV 10 | ≈ **36 pt** field height |
| Onboarding **chips** | `onboarding-streaming.tsx:104` padV 10 | ≈ **34 pt** |

Primaries with padV 14 + size 16 land near **44 pt** (welcome, connect-team, streaming Continue, PlayerPicker, all-set, notifications). Sign-in/up primaries use padV 12 (`spacing.md`) + 16 ≈ **40 pt** — slightly short.

**Uncertain:** iOS default `Pressable` highlight may enlarge perceived tappable area; `Switch` native controls are platform-sized.

---

## 3. Loading / empty / error states

Screens in play (PLAN.md §10 shipped set): welcome, sign-up, sign-in, connect-team (onboarding + Settings), onboarding-streaming, notifications-permission, onboarding-all-set, Home `index`, settings, edit-manual-lineup. Plus root session gate and the switching overlay.

### 3.1 Per-screen matrix

| Screen | Loading | Empty | Error | Notes / gaps |
| --- | --- | --- | --- | --- |
| **Root session** `app/app/_layout.tsx` | Local `LoadingState`: unthemed spinner + `#444` / 16 pt text, messages `"Loading session..."` / `"Redirecting..."` (`:8–14`, 41–46, 71–82). **No** `theme` background. | n/a | none | Highest-frequency chrome. Can flash a light/default canvas before auth screens’ dark `background`. |
| **Index redirect** `app/app/index.tsx` | Bare `ActivityIndicator` in a flex-centered view, **no** color, **no** message (`:9–14`, 24–29) | n/a | none | Same unthemed flash risk. |
| **Welcome** `welcome.tsx` | none (static) | n/a | n/a | Fine for a static landing. |
| **Sign in** `sign-in.tsx` | Spinner **in** the primary button (`:85–90`) | n/a | Inline `Text` `styles.error` (`:83`, 127–130) — not `ErrorState` | Validation + Supabase `error.message`. No retry control (user resubmits). |
| **Sign up** `sign-up.tsx` | Same as sign-in (`:113–118`) | n/a | Same inline red text (`:111`, 155–158) | Spec §10 also lists **Sign in with Apple**. **Not present** (no Apple button anywhere in `app/`). |
| **(app) gate / routing** `app/app/(app)/_layout.tsx` | **Local** `LoadingState` (not the shared component): themed background, **default** spinner color, `"Loading..."` (`:16–22`, 84–86, 101–107, 136–148) | Zero leagues → `redirect_connect` to connect-team (`:65–66`) | `leagues_error` → shared `ErrorState` with Retry (`:88–98`) | This is the roster-sync / routing screen. Duplicate LoadingState implementation vs `components/LoadingState.tsx`. Period vs ellipsis: `"Loading..."` here vs `"Loading…"` on Home. |
| **Home** `index.tsx` | Shared `LoadingState` `"Loading…"` (`:422–423`). Pull-to-refresh `RefreshControl` (`:402–407`). | **State 5:** `EmptyState` connect prompt (`:347–360`). **State 4a:** `IdleHomeCard`. **State 4** no next game: in-card copy (`HomeOffDayCard.tsx:34–38`). **State 3** with empty `groups`: hero still renders; section “Your lineup by game” can list nothing (`HomePregameCard.tsx:26–39`) — **uncertain** if the branch can fire with empty groups. **State 2** with empty `liveGames`: hero + label, no rows (`HomeLiveIdleCard.tsx:27–43`) — branch normally requires live stake games; **uncertain**. | Shared `ErrorState` + Retry (`:424–425`) | `renderBody` returns `null` if `homeData` is missing (`:344`) or State 1 with `flag` null (`:373–380`) → **blank body under the Home header**. Should be unreachable after a successful load; still crash-adjacent if a realtime update clears the flag without changing branch. **No** PLAN §10 reconnecting bar, no-internet banner, or “live data delayed” treatment. Cold-start copy is `"Loading…"`, not spec’s `"Pulling up today's games..."`. Shared `LoadingState` is used **without** `inline`, inside a `ScrollView` (`flex: 1` often does not fill in ScrollViews) — **uncertain** whether the spinner is vertically centered. |
| **Connect team** `connect-team.tsx` | Button spinner (Find leagues / Continue) (`:158–163`, 245–250); row spinner while connecting a league (`:182–184`); PlayerPicker save spinner | Choose-provider is always filled. Sleeper **zero leagues** is stuffed into `ErrorState` (danger color) with a long explanation (`:116–120`, 166). PlayerPicker empty roster: disabled save, no empty illustration. Username empty: Find leagues stays enabled; `onFindLeagues` no-ops (`:110`) — **no message**. | `ErrorState` **without** Retry (`:166`, 252); PlayerPicker save errors similarly | Highest-stakes onboarding step. Empty Sleeper leagues look like an error (red), not an empty state. Search/connect failures are not retryable via the shared Retry button. Close defers the gate (`:56–63`) → user lands on Home State 5. |
| **Onboarding streaming** `onboarding-streaming.tsx` | Spinner in Continue (`:82–87`) | Zero chips selected is valid (Continue still works; skip is a text link `:89–94`) | `ErrorState` no Retry (`:80`) | Save failure leaves `isSaving` false (`:45–46`) so the user can retry by tapping again. Skip bypasses save. |
| **Notifications permission** `notifications-permission.tsx` | Spinner in Enable (`:40–45`) | n/a | **None.** `requestAndRegister` is try/finally with no catch (`:19–26`) | Gate screen. After the OS prompt, layout navigates away. If the native call throws, the user sees a stuck/re-enabled button and no error copy. No “Not now” — skip is the layout leave path after status changes. |
| **All set** `onboarding-all-set.tsx` | none (static) | n/a | n/a | Single CTA, no failure path. |
| **Settings** `settings.tsx` | Shared `LoadingState` `"Loading settings…"` with header still shown (`:132–137`) | Leagues: `"No leagues connected yet."` muted caption (`:454–455`) — **not** `EmptyState`. Stars: `"No lineup yet — connect a team…"` (`:564–565`). Quiet hours off: extra rows hidden. | Load: `ErrorState` + Retry (`:141–153`). Mutations: `Alert.alert` (rename/sync/disconnect/save/delete/test push) | Empty leagues still show “Connect another team”. Star empty copy does not match PLAN §10 (`"Tap any player to mark them as a star"`). |
| **Edit manual lineup** `edit-manual-lineup.tsx` | Shared `LoadingState` `"Loading lineup…"` (`:111–112`) | Empty roster handled inside PlayerPicker (disabled save) | `ErrorState` + Retry when load fails / missing week (`:113–116`); save errors via PlayerPicker | Missing `leagueId` or non-manual platform shows ErrorState. Header Back always available. |
| **PlayerPicker** (embedded) | Search: small spinner (`:74`); save: spinner in primary (`:115–117`) | Query &lt; 2 chars: empty results list, no hint. Query ≥ 2 with zero hits: empty `FlatList`, **no** “no players found”. Empty roster heading still shows count 0. | Save: `ErrorState` no Retry (`:108`). **Search throws are swallowed** (`:55–59` try/finally, no catch) — spinner stops, list unchanged, no error | Search failure is the clearest silent-failure in onboarding. |
| **Switching overlay** `SwitchingContext.tsx` | Full-screen scrim + large spinner + `"Switching to {label}…"` (`:291–296`) | n/a | Error card + optional alternate rows + Close (`:266–290`) | Matches PLAN “deep-link in flight” / “target not installed” better than Home matches its error spec. Alternate “Watch” targets are undersized (see §2.5). |
| **In-app banner** `FlagEventBanner.tsx` | n/a (appears ready) | n/a | n/a | Auto-dismiss 12s. Not a screen. |

### 3.2 Highest-stakes screens (onboarding + routing)

**(app) layout gate** (`app/app/(app)/_layout.tsx`) is the roster-sync router: wait → connect-team (`?onboarding=1`) if zero leagues, else notifications catch-all, else Home. Loading is a **second, unshared** `LoadingState` with a default-colored spinner. League fetch failure is the one place this gate uses shared `ErrorState` with Retry — that path is solid.

**Connect-team** is the other high-stakes surface. Gaps: empty Sleeper leagues styled as danger; Find leagues silent no-op on empty username; no Retry on `ErrorState`; Close is an undersized text control that defers setup.

**Home** covers loading/error with shared components and State 5 with `EmptyState`. Missing vs PLAN §10 empty/loading/error: splash copy, reconnecting bar, offline banner, stale-live indicator, maintenance screen. `null` render on State 1 without a flag is the only crash-adjacent blank.

---

## 4. Brand expression check

### 4.1 Where the palette lives vs what the UI uses

**App palette** is `app/lib/theme.ts`: near-black `#0B0B0F`, charcoal surfaces, **amber `#FFB020`** accent, cream `onAccent` `#412402`. PLAN.md (Known Issues, resolved competing-accents entry) states the amber was chosen because no NFL team owns it as a primary — i.e. this **is** the Pivot-era palette, not a leftover FantasyFocus blue. Those old blues (`#1f6feb`, `#5aa2ff`, `#0A66FF`) do **not** appear in client styles anymore.

**Accent does show up as the primary UI accent** on: Welcome eyebrow + Get started; auth submit + links; connect-team Close + primaries; Home Settings link; Now-active CTA + reason-chip text (chip fill is a hardcoded amber wash); onboarding Continue / chips-selected / Enable / Go to Home; Settings links, segmented active, some fills; banner Switch; overlay Watch / Close.

**Where the UI still does not look “Pivot amber”:**

- Root session/index loaders: unthemed, `#444` text (`_layout.tsx:80`) — visually closer to the **marketing site** than to the app.
- Native `Switch` on-state (system green) on Settings.
- Default `ActivityIndicator` on both layout loaders.
- Auth/onboarding content sits on bare `background` with no surface cards — fine as a dark editorial look, but there is no logo/mark, no custom typeface, no illustration (`EmptyState.tsx:22–23` notes no icon system).
- `accentPressed` never appears, so amber buttons have no branded press state.
- `success` token unused — no success color in the product UI.

**Marketing site (`https://pivot-sports.app`, fetched Aug 30 2026):** Georgia / Times serif, `color: #1a1a1a`, tagline `#444`, no amber, no dark canvas, no shared tokens with the app. Privacy/support pages are the same document style. **App and site do not share a brand system.** The app is dark-amber product UI; the site is a light serif placeholder page.

**Uncertain:** whether `#444` on the root loader is a leftover from the site/docs era or an accidental unthemed default. It is not `theme.colors.textTertiary`.

### 4.2 Leftover “FantasyFocus” / “RosterRemote” in user-facing copy

Grep of `app/` TS/TSX (UI strings) and a repo-wide pass:

| Hit | User-facing? | Disposition |
| --- | --- | --- |
| `app/app.json` `slug: "fantasy-focus"` | No (EAS) | Frozen — out of scope |
| `app/app.json` `bundleIdentifier: "com.fantasyfocus.app"` | No | Frozen — out of scope |
| `scripts/seed-test-user.ts` default email `test@fantasyfocus.dev` and password `FantasyFocusTest123!` | No (local seed) | PLAN.md explicitly keeps these |
| PLAN.md / B3-HANDOFF.md historical rename notes | Docs, not UI | Not in-app copy |

**No** `FantasyFocus`, `Fantasy Focus`, or `RosterRemote` strings in screen copy, buttons, alerts, or Settings. In-app name is **Pivot** (welcome eyebrow `welcome.tsx:15`; notifications body `notifications-permission.tsx:34`; Settings About `settings.tsx:640`; disconnect alert `settings.tsx:504`; enable-notifications alerts `settings.tsx:601–611`). Support/legal URLs in Settings are `pivot-sports.app` (`settings.tsx:47–50`).

B3-HANDOFF.md still describes Settings linking `fantasyfocus.app` (handoff item 4). **That is stale documentation** — the live Settings code already points at `pivot-sports.app`. Not a UI-copy bug.

### 4.3 Splash screen / app icon

Inspectable from the repo without a simulator:

- `app/app.json` has **no** `icon`, **no** `splash`, **no** `android.adaptiveIcon`. Name is `"Pivot"` (`:3`).
- **No** `app/assets/` directory. **No** png/jpg/svg/webp anywhere in the repo (glob over the workspace).
- B3-HANDOFF.md:118–122 already records this: Expo default template icon; built `.app` only has default `AppIcon60x60@2x.png` / iPad variant; no splash configured; App Store 1024×1024 icon is a submission blocker.

PLAN.md §10 loading spec (“splash with ‘Pulling up today's games...’”) is **not** implemented. Cold start is the unthemed root spinner, then Home’s `"Loading…"`.

---

## Scope implications (not recommendations disguised as extra features)

The token file exists and most screens import it; the polish problem is **incomplete adoption**, not a missing theme module. Highest-leverage inconsistencies for a visual pass, if one is scoped:

1. Three competing primary-button recipes (radius 8 vs 10 vs 12; pad 12 vs 13 vs 14 vs 15; weight 600 vs 700) and two text-field recipes (bordered radius 8 vs borderless radius 10).
2. Type scale missing the sizes actually used for buttons (16), eyebrows (12/14), and body-with-lineHeight.
3. Unthemed root session loader (`#444`, no dark background) vs the rest of the dark amber app.
4. Touch targets on Settings chips, header Close/Back, Home Settings, and overlay Watch.
5. Connect-team / PlayerPicker empty and search-error gaps on the most-seen onboarding path.
6. Icon + splash still Expo defaults; marketing site palette is unrelated to the app.

Items marked **uncertain** above should not be treated as bugs without a product pass.
