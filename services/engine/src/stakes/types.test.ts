import { describe, expect, it } from 'vitest';
import { TRIGGER_KIND } from './types.js';

describe('TRIGGER_KIND', () => {
  it('maps possession, red zone, opponent red zone, and live possession to NUDGE', () => {
    expect(TRIGGER_KIND.POSSESSION_START).toBe('NUDGE');
    expect(TRIGGER_KIND.RED_ZONE).toBe('NUDGE');
    expect(TRIGGER_KIND.OPP_RED_ZONE).toBe('NUDGE');
    expect(TRIGGER_KIND.PROP_LIVE_POSSESSION).toBe('NUDGE');
  });

  it('maps every other code to REVEAL', () => {
    expect(TRIGGER_KIND.PROP_NEAR).toBe('REVEAL');
    expect(TRIGGER_KIND.PROP_DANGER).toBe('REVEAL');
    expect(TRIGGER_KIND.ONE_SCORE_LATE).toBe('REVEAL');
    expect(TRIGGER_KIND.PICK_TRAILING_2H).toBe('REVEAL');
    expect(TRIGGER_KIND.SPREAD_SWING).toBe('REVEAL');
    expect(TRIGGER_KIND.TOTAL_SWING).toBe('REVEAL');
    expect(TRIGGER_KIND.GAME_FINAL).toBe('REVEAL');
  });
});
