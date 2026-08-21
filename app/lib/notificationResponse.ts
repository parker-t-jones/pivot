import { isFlagEventPayload, type FlagEventPayload } from './flagEventPayload';
import type { NotificationUserAction } from './notificationActions';
import { resolvePossessingTeamDisplay } from './teamDisplay';

/**
 * Matches `expo-notifications`' `DEFAULT_ACTION_IDENTIFIER`. Inlined so this module stays free of
 * the native notifications package (unit-tested off-device); the handler component still compares
 * against `Notifications.DEFAULT_ACTION_IDENTIFIER` at the call site only if needed — today every
 * real push surfaces as this value because no notification category is registered yet.
 */
export const DEFAULT_NOTIFICATION_ACTION = 'expo.modules.notifications.actions.DEFAULT';

/**
 * iOS action-button identifiers a `flag_event` push's category *would* declare, per PLAN.md Section
 * 10's push format ("Action buttons: Switch and Dismiss"). Neither is wired up yet — that needs a
 * `Notifications.setNotificationCategoryAsync` call (client) plus a matching `categoryId` on the
 * outgoing Expo push message (`services/dispatcher/src/pushNotifier.ts`, currently doesn't set one).
 * Mapped anyway so this module doesn't have to change if/when that lands: today, every interaction
 * with a real push surfaces as `DEFAULT_NOTIFICATION_ACTION` (a tap on the notification body), which
 * Section 10 describes as "Tap → opens app to 'ready to launch' state" and which this maps to the
 * same outcome as an explicit "Switch".
 */
const ACTION_IDENTIFIER_TO_USER_ACTION: Record<string, NotificationUserAction> = {
  switch: 'switched',
  dismiss: 'dismissed',
};

/** Maps an OS notification action id to the Section 9 `user_action` value. */
export function resolveNotificationUserAction(actionIdentifier: string): NotificationUserAction {
  if (actionIdentifier === DEFAULT_NOTIFICATION_ACTION) return 'switched';
  return ACTION_IDENTIFIER_TO_USER_ACTION[actionIdentifier] ?? 'switched';
}

/**
 * The subset of `expo-notifications`' `NotificationResponse` this module reads. Kept structural so
 * unit tests can build fixtures without importing the native package.
 */
export interface NotificationResponseLike {
  actionIdentifier: string;
  notification: {
    request: {
      identifier: string;
      content: { data?: unknown };
    };
  };
}

/** The slice of `SwitchingContext.switchToGame` this module needs — kept narrow so unit tests
 *  don't mount the provider tree. */
export interface SwitchToGameInput {
  gameId: string;
  deepLinkUrl: string | null;
  label: string;
  teamName?: string;
  teamColors: { primary: string; secondary: string } | null;
}

export interface NotificationResponseDeps {
  switchToGame: (input: SwitchToGameInput) => void;
  recordNotificationAction: (
    action: NotificationUserAction,
    payload: FlagEventPayload,
  ) => Promise<void>;
}

export type ApplyNotificationResponseResult =
  | { handled: false; reason: 'not_flag_event' }
  | { handled: true; action: NotificationUserAction; eventId: string; switched: boolean };

/**
 * Pure application of a notification response: record the action, and if it was a Switch (or a
 * body tap, which we treat as Switch), hand off through `switchToGame`. Returns whether the
 * response was a `FlagEventPayload` so the caller can clear the last-response slot either way —
 * leaving a non-flag response stuck would re-fire this path on every remount of the handler.
 *
 * Extracted from `NotificationResponseHandler` so cold-start / background / foreground behaviour
 * can be unit-tested without mounting Expo's notification emitter, and so the component itself is
 * only responsible for *which* response it feeds in (`useLastNotificationResponse` vs. a live
 * listener that misses the launching tap).
 */
export function applyNotificationResponse(
  response: NotificationResponseLike,
  deps: NotificationResponseDeps,
): ApplyNotificationResponseResult {
  const { data } = response.notification.request.content;
  if (!isFlagEventPayload(data)) return { handled: false, reason: 'not_flag_event' };

  const action = resolveNotificationUserAction(response.actionIdentifier);
  void deps.recordNotificationAction(action, data);

  if (action !== 'switched') {
    return { handled: true, action, eventId: data.event_id, switched: false };
  }

  const { game_id, action: payloadAction, game_summary, new_state } = data;
  const possessingTeam = resolvePossessingTeamDisplay(game_summary, new_state.possession_team);
  deps.switchToGame({
    gameId: game_id,
    deepLinkUrl: payloadAction.deep_link_url,
    label: `${game_summary.away_team} @ ${game_summary.home_team}`,
    teamName: possessingTeam?.name,
    teamColors: possessingTeam
      ? { primary: possessingTeam.primaryColor, secondary: possessingTeam.secondaryColor }
      : null,
  });

  return { handled: true, action, eventId: data.event_id, switched: true };
}
