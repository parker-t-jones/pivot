import { describe, expect, it } from 'vitest';
import { parsePreferences } from './preferences.js';

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
