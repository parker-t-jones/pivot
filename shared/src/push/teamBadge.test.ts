import { describe, expect, it } from 'vitest';

import {
  PUSH_TEAM_BADGE_KEY,
  buildPushTeamBadge,
  parsePushTeamBadge,
  withPushTeamBadge,
} from './teamBadge.js';

describe('buildPushTeamBadge', () => {
  it('returns team color, ring, ink and initials for a known team', () => {
    expect(buildPushTeamBadge('KC')).toEqual({
      team: 'KC',
      initials: 'KC',
      fill: '#E31837',
      border: '#FFB612',
      ink: '#FFFFFF',
    });
  });

  it('normalizes case and whitespace', () => {
    expect(buildPushTeamBadge(' kc ')?.team).toBe('KC');
  });

  it('picks dark initials where white would fail 4.5:1', () => {
    expect(buildPushTeamBadge('NO')?.ink).toBe('#0B0B0F');
  });

  it.each([null, undefined, '', '  ', 'WSH', 'XXX'])('is null for %j', (value) => {
    expect(buildPushTeamBadge(value)).toBeNull();
  });
});

function badgeFor(abbr: string) {
  const badge = buildPushTeamBadge(abbr);
  if (!badge) throw new Error(`no badge for ${abbr}`);
  return badge;
}

describe('withPushTeamBadge', () => {
  const badge = badgeFor('KC');

  it('adds the badge beside the existing data without mutating it', () => {
    const data = { event_id: 'e1' };
    expect(withPushTeamBadge(data, badge)).toEqual({
      event_id: 'e1',
      [PUSH_TEAM_BADGE_KEY]: badge,
    });
    expect(data).toEqual({ event_id: 'e1' });
  });

  it('creates data when there is none', () => {
    expect(withPushTeamBadge(undefined, badge)).toEqual({ [PUSH_TEAM_BADGE_KEY]: badge });
  });

  it.each([null, [1], 'text', 5])('leaves non-object data %j untouched', (data) => {
    expect(withPushTeamBadge(data, badge)).toBe(data);
  });
});

describe('parsePushTeamBadge', () => {
  it('round-trips a built badge', () => {
    const badge = buildPushTeamBadge('GB');
    expect(parsePushTeamBadge(JSON.parse(JSON.stringify(badge)))).toEqual(badge);
  });

  it.each([
    null,
    'KC',
    [],
    {},
    { team: 'KC', initials: 'KC', fill: 'red', border: '#FFB612', ink: '#FFFFFF' },
    { team: 'KC', initials: 'KC', fill: '#E31837', border: '#FFB612' },
  ])('is null for malformed input %j', (value) => {
    expect(parsePushTeamBadge(value)).toBeNull();
  });
});
