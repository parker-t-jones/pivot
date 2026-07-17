import * as Notifications from 'expo-notifications';

import type { FlagEventPayload } from './flagEventPayload';

/** PLAN.md Section 10 push notification format example, used verbatim as the test payload's copy so
 *  a test notification looks exactly like what Sprint 6 Phase 2's `notificationContent.ts` would
 *  actually produce for a `flag_added` red-zone-adjacent event. */
const TEST_TITLE = 'Jonathan Taylor active';
const TEST_BODY = 'Colts have the ball — Q2, 7:14. Tap to watch.';

function buildTestPayload(): FlagEventPayload {
  const now = Date.now();
  return {
    event_id: `test-event-${now}`,
    user_id: 'test-user',
    game_id: 'test-game',
    event_type: 'flag_added',
    old_state: null,
    new_state: {
      gameId: 'test-game',
      flagged: true,
      priorityScore: 60,
      reasons: [{ type: 'offense_active', triggeringPlayerIds: ['test-player'] }],
      computedAt: now,
      possession_team: 'IND',
    },
    action: {
      type: 'prompt',
      cta: 'switch_primary',
      recommended_source: null,
      deep_link_url: null,
    },
    game_summary: {
      home_team: 'IND',
      away_team: 'DEN',
      home_team_name: 'Colts',
      away_team_name: 'Broncos',
      home_team_primary_color: '#002C5F',
      home_team_secondary_color: '#A2AAAD',
      away_team_primary_color: '#FB4F14',
      away_team_secondary_color: '#002244',
      score: { home: 10, away: 7 },
      quarter: 2,
      time_remaining_sec: 434,
    },
    flagged_players: [
      { player_id: 'test-player', first_name: 'Jonathan', last_name: 'Taylor', position: 'RB' },
    ],
  };
}

/**
 * PLAN.md Section 10 Home State 3's "Subtle 'Test notifications' link" — and Sprint 6 Phase 6's
 * "simulator-friendly testing" ask. Expo Go dropped push support on SDK 53+ (Sprint 6 Phase 5
 * discovery), so a *scheduled local* notification is the only way to exercise the full
 * `addNotificationReceivedListener` -> `NotificationBannerHost` -> `FlagEventBanner` pipeline without
 * a physical device and a development build. A 2s delay (rather than firing synchronously) is what
 * lets this be triggered from a button tap and still go through the OS's real notification-delivery
 * path — `scheduleNotificationAsync` with an immediate/zero-second trigger risks the OS coalescing it
 * into the call stack that scheduled it rather than a genuine async delivery.
 *
 * Uses whatever permission state already exists — same behavior a real push would have if permission
 * were denied (nothing is delivered, silently, exactly like a real push into a denied device).
 */
export async function scheduleTestFlagNotificationAsync(): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: TEST_TITLE,
      body: TEST_BODY,
      data: buildTestPayload() as unknown as Record<string, unknown>,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 2,
    },
  });
}
