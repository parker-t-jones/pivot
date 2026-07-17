import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';

import { FlagEventBanner, type FlagEventBannerData } from './FlagEventBanner';
import { useSwitching } from '../contexts/SwitchingContext';
import { isFlagEventPayload } from '../lib/flagEventPayload';
import { recordNotificationAction, type NotificationUserAction } from '../lib/notificationActions';
import { resolvePossessingTeamDisplay } from '../lib/teamDisplay';

/**
 * Sprint 6 Phase 6 — suppresses the OS's own foreground presentation. `NotificationBannerHost`
 * below renders PLAN.md Section 10's custom in-app banner instead of the native one, so both would
 * otherwise show at once. This only controls foreground *presentation*: `addNotificationReceivedListener`
 * (what actually drives the custom banner) fires regardless of what this returns, on both foreground
 * and background/backgrounded-then-foregrounded delivery. Set once at module scope — it needs to be
 * installed before any notification can arrive, and there's exactly one call site for it in the app.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let nextBannerKey = 0;

/**
 * Mounted once inside the `(app)` group (`(app)/_layout.tsx`), as an overlay sibling to the group's
 * `<Stack>`. Owns the foreground half of the notification pipeline: installs the handler above
 * (import-time side effect), listens for notifications received while the app is running, and
 * renders `FlagEventBanner` for the most recent one. The backgrounded half — a tap on the
 * notification itself — is `NotificationResponseHandler`'s job, mounted alongside this component;
 * the two never fire for the same interaction (see that component's docstring).
 *
 * Deliberately only tracks one banner at a time (last-in-wins) — Section 10 doesn't describe a
 * queue or stacking behavior, and the dispatcher's per-user rate limiting (Sprint 5) already keeps
 * arrivals infrequent enough that this isn't a real product gap for v1.
 */
export function NotificationBannerHost() {
  const { switchToGame } = useSwitching();
  const [activeBanner, setActiveBanner] = useState<FlagEventBannerData | null>(null);
  const activeBannerRef = useRef<FlagEventBannerData | null>(null);
  activeBannerRef.current = activeBanner;

  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const { title, body, data } = notification.request.content;

      if (!isFlagEventPayload(data)) {
        console.warn('[banner] received notification with unrecognized data shape — ignoring', data);
        return;
      }

      setActiveBanner({
        key: nextBannerKey++,
        title: title ?? '',
        body: body ?? '',
        payload: data,
      });
    });

    return () => subscription.remove();
  }, []);

  const onAction = useCallback(
    (action: NotificationUserAction) => {
      const banner = activeBannerRef.current;
      if (!banner) return;
      // Dismiss immediately — the user's action succeeds locally regardless of network state (see
      // `recordNotificationAction`'s docstring). Not awaited: recording is fire-and-forget from the
      // UI's perspective.
      void recordNotificationAction(action, banner.payload);
      setActiveBanner(null);

      // Sprint 7 Phase 6 — a "Switch" now actually hands off to the game's deep link (Section 10),
      // using the recommended source the dispatcher already resolved into the flag payload.
      if (action === 'switched') {
        const { game_id, action: payloadAction, game_summary, new_state } = banner.payload;
        // Sprint 9 Phase 2 — the realtime payload already carries `possession_team` (Phase 1), the
        // most direct source for the overlay's team name/color-flash on this path (more direct than
        // the cold-start path's lineup cross-reference — see `teamDisplay.ts`).
        const possessingTeam = resolvePossessingTeamDisplay(game_summary, new_state.possession_team);
        switchToGame({
          gameId: game_id,
          deepLinkUrl: payloadAction.deep_link_url,
          label: `${game_summary.away_team} @ ${game_summary.home_team}`,
          teamName: possessingTeam?.name,
          teamColors: possessingTeam
            ? { primary: possessingTeam.primaryColor, secondary: possessingTeam.secondaryColor }
            : null,
        });
      }
    },
    [switchToGame],
  );

  if (!activeBanner) return null;

  return <FlagEventBanner banner={activeBanner} onAction={onAction} />;
}
