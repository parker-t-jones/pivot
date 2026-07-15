import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { isFlagEventPayload } from '../lib/flagEventPayload';
import { recordNotificationAction, type NotificationUserAction } from '../lib/notificationActions';

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
  const router = useRouter();

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const { data } = response.notification.request.content;
      if (!isFlagEventPayload(data)) return;

      const action: NotificationUserAction =
        response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER
          ? 'switched'
          : ACTION_IDENTIFIER_TO_USER_ACTION[response.actionIdentifier] ?? 'switched';

      void recordNotificationAction(action, data);

      if (action === 'switched') {
        // TODO(Sprint 7): open the specific game (`data.game_id`) via PlaybackSource instead of
        // Home. Sprint 6 stops at "opens Home" per the sprint's deep-link decision — this is meant
        // to be a single-line swap once PlaybackSource lands.
        router.replace('/(app)');
      }
    });

    return () => subscription.remove();
  }, [router]);

  return null;
}
