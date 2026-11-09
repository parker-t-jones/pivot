import { describe, expect, it } from 'vitest';
import {
  alertDelaySecondsFor,
  alertTimingIsOnTime,
  parsePreferences,
  type AlertTiming,
} from './preferences.js';

describe('watchOpponent', () => {
  it('keeps true through parse, serialize, and parse', () => {
    const parsed = parsePreferences({ watchOpponent: true });
    const again = parsePreferences(JSON.parse(JSON.stringify(parsed)));
    expect(again.watchOpponent).toBe(true);
  });

  it('is false when the key is absent', () => {
    expect(parsePreferences({}).watchOpponent).toBe(false);
    expect(parsePreferences(undefined).watchOpponent).toBe(false);
  });

  it('strips an unknown sibling key', () => {
    const parsed = parsePreferences({ watchOpponent: true, notAPreference: 'keep-me' });
    expect(parsed.watchOpponent).toBe(true);
    expect(Object.hasOwn(parsed, 'notAPreference')).toBe(false);
  });
});

describe('following', () => {
  it('keeps the selection through parse, serialize, and parse', () => {
    const parsed = parsePreferences({ following: ['bets', 'survivor'] });
    const again = parsePreferences(JSON.parse(JSON.stringify(parsed)));
    expect(again.following).toEqual(['bets', 'survivor']);
  });

  it('is empty when the key is absent', () => {
    expect(parsePreferences({}).following).toEqual([]);
    expect(parsePreferences(undefined).following).toEqual([]);
  });

  it('rejects an option that is not fantasy, bets, or survivor', () => {
    expect(() => parsePreferences({ following: ['prediction_markets'] })).toThrow();
  });
});

describe('alertTiming', () => {
  it('defaults to On time with no overrides', () => {
    expect(parsePreferences({}).alertTiming).toEqual({
      defaultDelaySeconds: 0,
      serviceDelaySeconds: {},
    });
  });

  it('keeps a default and overrides through parse, serialize, and parse', () => {
    const parsed = parsePreferences({
      alertTiming: { defaultDelaySeconds: 20, serviceDelaySeconds: { peacock: 90, fubo: 0 } },
    });
    const again = parsePreferences(JSON.parse(JSON.stringify(parsed)));
    expect(again.alertTiming).toEqual({
      defaultDelaySeconds: 20,
      serviceDelaySeconds: { peacock: 90, fubo: 0 },
    });
  });

  it.each([-5, 7, 95, 1.5])('rejects %s seconds', (seconds) => {
    expect(() => parsePreferences({ alertTiming: { defaultDelaySeconds: seconds } })).toThrow();
  });

  it('rejects an override for a service that does not exist', () => {
    expect(() =>
      parsePreferences({ alertTiming: { serviceDelaySeconds: { not_a_service: 10 } } }),
    ).toThrow();
  });

  const timing: AlertTiming = {
    defaultDelaySeconds: 15,
    serviceDelaySeconds: { youtube_tv: 40, peacock: 0 },
  };

  it('uses the override for the destination service', () => {
    expect(alertDelaySecondsFor(timing, 'youtube_tv')).toBe(40);
    expect(alertDelaySecondsFor(timing, 'peacock')).toBe(0);
  });

  it('uses the default for a service without an override, an unknown key, or no service', () => {
    expect(alertDelaySecondsFor(timing, 'fubo')).toBe(15);
    expect(alertDelaySecondsFor(timing, 'netflix')).toBe(15);
    expect(alertDelaySecondsFor(timing, null)).toBe(15);
  });

  it('is on time only when every value is 0', () => {
    expect(alertTimingIsOnTime({ defaultDelaySeconds: 0, serviceDelaySeconds: {} })).toBe(true);
    expect(alertTimingIsOnTime({ defaultDelaySeconds: 0, serviceDelaySeconds: { fubo: 0 } })).toBe(
      true,
    );
    expect(alertTimingIsOnTime({ defaultDelaySeconds: 5, serviceDelaySeconds: {} })).toBe(false);
    expect(alertTimingIsOnTime({ defaultDelaySeconds: 0, serviceDelaySeconds: { fubo: 5 } })).toBe(
      false,
    );
  });
});
