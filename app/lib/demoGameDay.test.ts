import { describe, expect, it } from 'vitest';

import {
  DEMO_AWAY_TEAM,
  DEMO_HOME_TEAM,
  DEMO_NOTIFICATION_BODY,
  DEMO_NOTIFICATION_TITLE,
  DEMO_PRE_GAME_MS,
  DEMO_TOTAL_MS,
  demoPhaseAtElapsed,
} from './demoGameDay';

const REAL_NFL_TEAM_NAMES = [
  'chiefs',
  'raiders',
  'bills',
  'dolphins',
  'cowboys',
  'eagles',
  'colts',
  'broncos',
  'patriots',
];

describe('demoPhaseAtElapsed', () => {
  it('is pre_game before the kickoff threshold', () => {
    expect(demoPhaseAtElapsed(0)).toBe('pre_game');
    expect(demoPhaseAtElapsed(DEMO_PRE_GAME_MS - 1)).toBe('pre_game');
  });

  it('is live from kickoff until the total runtime', () => {
    expect(demoPhaseAtElapsed(DEMO_PRE_GAME_MS)).toBe('live');
    expect(demoPhaseAtElapsed(DEMO_TOTAL_MS - 1)).toBe('live');
  });

  it('is done once the total runtime elapses', () => {
    expect(demoPhaseAtElapsed(DEMO_TOTAL_MS)).toBe('done');
    expect(demoPhaseAtElapsed(DEMO_TOTAL_MS + 60_000)).toBe('done');
  });
});

describe('demo fixture copy', () => {
  it('never names a real NFL team, in the slate or the notification', () => {
    const haystack = [
      DEMO_HOME_TEAM.name,
      DEMO_AWAY_TEAM.name,
      DEMO_NOTIFICATION_TITLE,
      DEMO_NOTIFICATION_BODY,
    ]
      .join(' ')
      .toLowerCase();
    for (const team of REAL_NFL_TEAM_NAMES) {
      expect(haystack).not.toContain(team);
    }
  });

  it('labels the notification clearly as a demo', () => {
    expect(DEMO_NOTIFICATION_TITLE.toLowerCase()).toContain('demo');
  });
});
