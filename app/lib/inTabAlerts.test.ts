import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FlagEventPayload } from './flagEventPayload';
import {
  isPivotPushMessage,
  offerInTabAlert,
  readAlertSoundEnabled,
  resetInTabAlertsForTests,
  shouldShowInTabAlert,
  subscribeInTabAlerts,
  writeAlertSoundEnabled,
} from './inTabAlerts';

function payload(eventType: FlagEventPayload['event_type'], eventId = 'evt-1'): FlagEventPayload {
  return {
    event_id: eventId,
    user_id: 'u',
    game_id: 'g',
    event_type: eventType,
    old_state: null,
    new_state: {
      gameId: 'g',
      flagged: true,
      priorityScore: 1,
      reasons: [],
      computedAt: 1,
      possession_team: null,
    },
    action: { type: 'prompt', cta: null, recommended_source: null, deep_link_url: null },
    game_summary: {
      home_team: 'IND',
      away_team: 'DEN',
      home_team_name: 'Colts',
      away_team_name: 'Broncos',
      home_team_primary_color: '',
      home_team_secondary_color: '',
      away_team_primary_color: '',
      away_team_secondary_color: '',
      score: { home: 0, away: 0 },
      quarter: 2,
      time_remaining_sec: 400,
      possession_team: null,
      yards_to_endzone: null,
      down: null,
      distance: null,
      in_red_zone: false,
    },
    flagged_players: [],
  };
}

describe('in-tab alerts', () => {
  afterEach(() => {
    resetInTabAlertsForTests();
    vi.unstubAllGlobals();
  });

  it('shows a routing nudge once while the tab is visible', () => {
    expect(
      shouldShowInTabAlert({
        eventId: 'evt-1',
        eventType: 'flag_added',
        visible: true,
        alreadySeen: false,
      }),
    ).toBe(true);
    expect(
      shouldShowInTabAlert({
        eventId: 'evt-1',
        eventType: 'bet_in_play',
        visible: false,
        alreadySeen: false,
      }),
    ).toBe(false);
    expect(
      shouldShowInTabAlert({
        eventId: 'evt-1',
        eventType: 'flag_removed',
        visible: true,
        alreadySeen: false,
      }),
    ).toBe(false);
  });

  it('shows one banner when the socket and the service worker both deliver the event', () => {
    const seen: string[] = [];
    subscribeInTabAlerts((alert) => seen.push(alert.payload.event_id));
    const alert = { title: 'Colts', body: 'Q2', payload: payload('flag_added') };

    expect(offerInTabAlert(alert, true)).toBe(true);
    expect(offerInTabAlert(alert, true)).toBe(false);
    expect(seen).toEqual(['evt-1']);
  });

  it('does not consume an event that arrived while the tab was hidden', () => {
    const alert = { title: 'Colts', body: 'Q2', payload: payload('bet_in_play') };
    expect(offerInTabAlert(alert, false)).toBe(false);
    expect(offerInTabAlert(alert, true)).toBe(true);
  });

  it('accepts a service-worker push message with a flag payload', () => {
    expect(
      isPivotPushMessage({
        type: 'pivot-push',
        title: 'Colts',
        body: 'Q2',
        payload: payload('flag_added'),
      }),
    ).toBe(true);
    expect(isPivotPushMessage({ type: 'pivot-push', title: 'Colts', body: 'Q2' })).toBe(false);
  });

  it('keeps the sound on unless Settings turns it off', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    });

    expect(readAlertSoundEnabled()).toBe(true);
    writeAlertSoundEnabled(false);
    expect(readAlertSoundEnabled()).toBe(false);
    writeAlertSoundEnabled(true);
    expect(readAlertSoundEnabled()).toBe(true);
  });
});
