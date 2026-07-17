import { describe, expect, it } from 'vitest';
import { BROADCAST_TEMPLATES, buildBroadcastRows, otaForIndex } from './seed-broadcasts.js';

describe('otaForIndex', () => {
  it('rotates deterministically through the OTA networks', () => {
    expect(otaForIndex(0)).toBe('fox');
    expect(otaForIndex(1)).toBe('cbs');
    expect(otaForIndex(2)).toBe('nbc');
    expect(otaForIndex(3)).toBe('abc');
    expect(otaForIndex(4)).toBe('fox');
  });
});

describe('buildBroadcastRows', () => {
  it('produces one free OTA row plus the two paid streaming rows for a game', () => {
    const rows = buildBroadcastRows('game-1', 0);

    expect(rows).toEqual([
      { game_id: 'game-1', service: 'fox', deep_link_url: BROADCAST_TEMPLATES['fox']?.deepLinkUrl, requires_subscription: false },
      { game_id: 'game-1', service: 'sunday_ticket', deep_link_url: BROADCAST_TEMPLATES['sunday_ticket']?.deepLinkUrl, requires_subscription: true },
      { game_id: 'game-1', service: 'nfl_plus', deep_link_url: BROADCAST_TEMPLATES['nfl_plus']?.deepLinkUrl, requires_subscription: true },
    ]);
  });

  it('assigns the rotating OTA network by game index', () => {
    expect(buildBroadcastRows('g', 1)[0]?.service).toBe('cbs');
    expect(buildBroadcastRows('g', 2)[0]?.service).toBe('nbc');
  });

  it('marks only the OTA network as free', () => {
    const rows = buildBroadcastRows('g', 0);
    expect(rows.filter((r) => !r.requires_subscription).map((r) => r.service)).toEqual(['fox']);
  });
});
