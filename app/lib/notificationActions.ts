import { apiClient } from './apiClient';
import type { FlagEventPayload } from './flagEventPayload';

/** Matches Section 9's `POST /flags/:event_id/action` body values, plus `'ignored'` for the
 *  foreground banner's auto-dismiss case — recorded the same way as an explicit action. */
export type NotificationUserAction = 'switched' | 'dismissed' | 'ignored';

/**
 * Sprint 6 Phase 7 — records a user's response to a flag-event notification against the
 * `flag_events` row `payload.event_id` identifies. Shared by both interaction paths: the foreground
 * in-app banner (`FlagEventBanner`'s buttons / 12s auto-dismiss, via `NotificationBannerHost`) and a
 * backgrounded notification's tap (`NotificationResponseHandler`) — same server-side effect either
 * way, so one function owns it.
 *
 * Best-effort by design: a failed request is logged and swallowed, never re-thrown. Both call sites
 * dismiss the banner / navigate before this settles — a dropped network request must not make the
 * user's tap feel like it did nothing, it just means `flag_events.user_action` falls out of sync
 * with what actually happened until the next successful action on the same row. Acceptable for v1
 * per the same "best-effort" standard Phase 3's push send holds to.
 */
export async function recordNotificationAction(
  action: NotificationUserAction,
  payload: FlagEventPayload,
): Promise<void> {
  try {
    await apiClient.post(`/flags/${payload.event_id}/action`, { action });
  } catch (error) {
    console.warn('[notifications] failed to record action', {
      action,
      eventId: payload.event_id,
      error,
    });
  }
}
