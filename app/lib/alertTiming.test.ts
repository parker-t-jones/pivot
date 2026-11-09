import { describe, expect, it } from 'vitest';
import {
  ALERT_DELAY_MAX_SECONDS as SHARED_MAX,
  ALERT_DELAY_STEP_SECONDS as SHARED_STEP,
} from '../../shared/src/types/preferences';

import {
  ALERT_DELAY_MAX_SECONDS,
  ALERT_DELAY_STEP_SECONDS,
  ALERT_TIMING_HINT,
  alertTimingServices,
  formatAlertDelay,
  formatServiceDelay,
  stepDefaultDelay,
  stepServiceDelay,
} from './alertTiming';

describe('alertTiming', () => {
  it('mirrors the server limits', () => {
    expect(ALERT_DELAY_STEP_SECONDS).toBe(SHARED_STEP);
    expect(ALERT_DELAY_MAX_SECONDS).toBe(SHARED_MAX);
  });

  it('labels 0 as On time and anything else as +Ns', () => {
    expect(formatAlertDelay(0)).toBe('On time');
    expect(formatAlertDelay(5)).toBe('+5s');
    expect(formatAlertDelay(90)).toBe('+90s');
    expect(formatServiceDelay(null)).toBe('Same as default');
    expect(formatServiceDelay(0)).toBe('On time');
  });

  it('steps the default in 5s between On time and +90s', () => {
    expect(stepDefaultDelay(0, 1)).toBe(5);
    expect(stepDefaultDelay(0, -1)).toBe(0);
    expect(stepDefaultDelay(85, 1)).toBe(90);
    expect(stepDefaultDelay(90, 1)).toBe(90);
  });

  it('steps a service from Same as default to On time and back', () => {
    expect(stepServiceDelay(null, 1)).toBe(0);
    expect(stepServiceDelay(null, -1)).toBeNull();
    expect(stepServiceDelay(0, -1)).toBeNull();
    expect(stepServiceDelay(0, 1)).toBe(5);
    expect(stepServiceDelay(90, 1)).toBe(90);
  });

  it('lists only subscribed services, in picker order', () => {
    expect(
      alertTimingServices([
        { service: 'peacock', has_subscription: true },
        { service: 'fubo', has_subscription: false },
        { service: 'youtube_tv', has_subscription: true },
      ]),
    ).toEqual(['youtube_tv', 'peacock']);
  });

  it('explains the setting in full sentences, with no head-start framing', () => {
    expect(ALERT_TIMING_HINT).toBe(
      'If you usually land in a commercial, add a delay. If you land mid-drive, use On time.',
    );
    expect(ALERT_TIMING_HINT).not.toMatch(/early|ahead|edge|stake/i);
  });
});
