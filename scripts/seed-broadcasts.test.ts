import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCOREBOARD_PATH, airingSourceFor, parseScoreboardSource } from './seed-broadcasts.js';

describe('parseScoreboardSource', () => {
  it('defaults to the saved Week 3 scoreboard', () => {
    expect(parseScoreboardSource([])).toEqual({ kind: 'file', path: DEFAULT_SCOREBOARD_PATH });
  });

  it('accepts --live or one path, not both', () => {
    expect(parseScoreboardSource(['--live'])).toEqual({ kind: 'live' });
    expect(parseScoreboardSource(['x.json'])).toEqual({ kind: 'file', path: path.resolve('x.json') });
    expect(() => parseScoreboardSource(['--live', 'x.json'])).toThrow(/mutually exclusive/);
    expect(() => parseScoreboardSource(['--bogus'])).toThrow(/unknown flag/);
  });
});

describe('airingSourceFor', () => {
  it('tags a saved payload as a fixture and --live as a real scoreboard read', () => {
    expect(airingSourceFor({ kind: 'file', path: DEFAULT_SCOREBOARD_PATH })).toBe('espn_scoreboard_fixture');
    expect(airingSourceFor({ kind: 'live' })).toBe('espn_scoreboard');
  });
});
