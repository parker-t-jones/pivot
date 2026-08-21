import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';

import { useSwitching } from '../contexts/SwitchingContext';
import { recordNotificationAction } from '../lib/notificationActions';
import { applyNotificationResponse } from '../lib/notificationResponse';

/**
 * Sprint 6 Phase 7 — the OS-notification half of the notification pipeline
 * (`NotificationBannerHost` is the foregrounded in-app half). Fires when the user interacts with
 * the actual OS notification — lock screen, notification center, or a background/killed app's push
 * banner — as opposed to `NotificationBannerHost`'s custom in-app banner, whose buttons are plain
 * React `Pressable`s and never go through `expo-notifications` at all. The two are mutually
 * exclusive: a given notification is either interacted with in-app (banner buttons) or via the OS
 * (this handler), never both.
 *
 * Mounted once alongside `NotificationBannerHost` in `(app)/_layout.tsx`.
 *
 * Sprint 10 Track B — uses `useLastNotificationResponse` rather than
 * `addNotificationResponseReceivedListener` alone. The listener only delivers responses that arrive
 * *after* subscription; this component mounts behind auth restore, the leagues gate, and
 * `SwitchingProvider`, so a tap that *launched* a killed app is delivered before the listener exists
 * and was previously dropped (Known Issue). The hook reads the native last-response on mount *and*
 * listens for subsequent ones, covering killed / backgrounded / foregrounded with one path. After
 * handling we clear the slot so a remount cannot re-fire the same tap.
 */
export function NotificationResponseHandler() {
  const { switchToGame } = useSwitching();
  const lastResponse = Notifications.useLastNotificationResponse();
  /** Guards React Strict Mode's double-effect and any remount before clear settles. */
  const handledIdentifierRef = useRef<string | null>(null);

  useEffect(() => {
    // `undefined` = hook not yet sure; `null` = no response yet. Either way there is nothing to do.
    if (lastResponse == null) return;

    const identifier = lastResponse.notification.request.identifier;
    if (handledIdentifierRef.current === identifier) return;

    applyNotificationResponse(lastResponse, { switchToGame, recordNotificationAction });
    handledIdentifierRef.current = identifier;
    // Clear whether or not it was a flag_event — a stuck non-flag response would otherwise keep
    // re-entering this effect on every remount of the handler.
    Notifications.clearLastNotificationResponse();
  }, [lastResponse, switchToGame]);

  return null;
}
