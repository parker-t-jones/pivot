import { describe, expect, it } from 'vitest';

import { notificationClickUrl } from './notificationOpenTarget';

const ORIGIN = 'https://pivot.example';

describe('notificationClickUrl', () => {
  it('opens a saved https link', () => {
    expect(
      notificationClickUrl(
        {
          event_type: 'bet_in_play',
          game_id: 'g1',
          action: { saved_url: 'https://example.com/saved', deep_link_url: null },
        },
        ORIGIN,
      ),
    ).toBe('https://example.com/saved');
  });

  it('opens the generated watch link when nothing is saved', () => {
    expect(
      notificationClickUrl(
        {
          event_type: 'flag_added',
          game_id: 'g1',
          action: { deep_link_url: 'https://www.fox.com/live/channels' },
        },
        ORIGIN,
      ),
    ).toBe('https://www.fox.com/live/channels');
  });

  it('routes a missing link to that game inside Pivot', () => {
    expect(
      notificationClickUrl(
        { event_type: 'flag_added', game_id: 'g1', action: { deep_link_url: null } },
        ORIGIN,
      ),
    ).toBe('https://pivot.example/?game=g1');
  });

  it('ignores other event types', () => {
    expect(notificationClickUrl({ event_type: 'flag_removed', game_id: 'g1' }, ORIGIN)).toBeNull();
  });
});
