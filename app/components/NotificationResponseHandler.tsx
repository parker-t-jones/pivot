import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';

import { useSwitching } from '../contexts/SwitchingContext';
import { isFlagEventPayload } from '../lib/flagEventPayload';
import { recordNotificationAction, type NotificationUserAction } from '../lib/notificationActions';
import { resolvePossessingTeamDisplay } from '../lib/teamDisplay';

/**
 * iOS action-button identifiers a `flag_event` push's category *would* declare, per PLAN.md Section
 * 10's push format ("Action buttons: Switch and Dismiss"). Neither is wired up yet — that needs a
 * `Notifications.setNotificationCategoryAsync` call (client) plus a matching `categoryId` on the
 * outgoing Expo push message (`services/dispatcher/src/pushNotifier.ts`, currently doesn't set one)
 * — out of Sprint 6 Phase 7's scope (not one of the phase's five listed decisions). Mapped anyway so
 * this handler doesn't have to change if/when that lands: today, every interaction with a real push
 * surfaces as `Notifications.DEFAULT_ACTION_IDENTIFIER` (a tap on the notification body), handled
 * below the same way Section 10 describes it — "Tap → opens app to 'ready to launch' state" — which
 * this maps to the same outcome as an explicit "Switch".
 */
const ACTION_IDENTIFIER_TO_USER_ACTION: Record<string, NotificationUserAction> = {
  switch: 'switched',
  dismiss: 'dismissed',
};

/**
 * Sprint 6 Phase 7 — the backgrounded half of the notification pipeline (`NotificationBannerHost`
 * is the foregrounded half). Fires when the user interacts with the actual OS notification — lock
 * screen, notification center, or a background/killed app's push banner — as opposed to
 * `NotificationBannerHost`'s custom in-app banner, whose buttons are plain React `Pressable`s and
 * never go through `expo-notifications` at all. The two are mutually exclusive: a given notification
 * is either interacted with in-app (banner buttons) or via the OS (this handler), never both.
 *
 * Mounted once alongside `NotificationBannerHost` in `(app)/_layout.tsx`.
 */
export function NotificationResponseHandler() {
  const { switchToGame } = useSwitching();

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const { data } = response.notification.request.content;
      if (!isFlagEventPayload(data)) return;

      const action: NotificationUserAction =
        response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER
          ? 'switched'
          : ACTION_IDENTIFIER_TO_USER_ACTION[response.actionIdentifier] ?? 'switched';

      void recordNotificationAction(action, data);

      // Sprint 9 Phase 2 — closes the Sprint 7 TODO this handler carried since Phase 6: a tap on
      // the OS notification itself now hands off through `PlaybackSource` the same way the
      // foreground banner's "Switch" button does (`NotificationBannerHost`), instead of just
      // opening Home and leaving the user to find the game themselves.
      if (action === 'switched') {
        const { game_id, action: payloadAction, game_summary, new_state } = data;
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
    });

    return () => subscription.remove();
  }, [switchToGame]);

  return null;
}
