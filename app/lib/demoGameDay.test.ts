import { describe, expect, it } from 'vitest';

import {
  DEMO_AWAY_TEAM,
  DEMO_HIT_AT_MS,
  DEMO_HOME_TEAM,
  DEMO_NOTIFICATION_BODY,
  DEMO_NOTIFICATION_TITLE,
  DEMO_PRE_GAME_MS,
  DEMO_TOTAL_MS,
  demoPhaseAtElapsed,
  demoPossessionLine,
  demoSnapshotAtElapsed,
  demoTickerLine,
  type DemoLiveGame,
} from './demoGameDay';
import {
  EMPTY_PICK_HIT_TRACKER,
  detectPickHits,
  isFlashEligible,
  pickHitCopy,
} from './pickHitFlash';

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
      ...demoSnapshotAtElapsed(DEMO_HIT_AT_MS).picks.map((pick) => pick.label),
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

describe('demo pick timeline', () => {
  /** Every tick of the demo, 500ms apart, as the screen feeds them to `usePickHitFlash`. */
  function ticks(): ReturnType<typeof demoSnapshotAtElapsed>[] {
    const out = [];
    for (let elapsed = 0; elapsed <= DEMO_TOTAL_MS; elapsed += 500) {
      out.push(demoSnapshotAtElapsed(elapsed));
    }
    return out;
  }

  it('runs the same LIVE → HIT diff the Watchlist runs, and it fires exactly once', () => {
    let tracker = EMPTY_PICK_HIT_TRACKER;
    const fired: string[] = [];
    for (const snapshot of ticks()) {
      const result = detectPickHits(tracker, snapshot.picks);
      tracker = result.tracker;
      fired.push(...result.hits.map((hit) => hit.id));
    }
    expect(fired).toEqual(['demo-prop']);
  });

  it('is pending before kickoff, live after, and hit from DEMO_HIT_AT_MS', () => {
    const status = (elapsed: number) =>
      demoSnapshotAtElapsed(elapsed).picks.find((pick) => pick.id === 'demo-prop')?.progress.status;
    expect(status(0)).toBe('pending');
    expect(status(DEMO_PRE_GAME_MS)).toBe('live');
    expect(status(DEMO_HIT_AT_MS - 1)).toBe('live');
    expect(status(DEMO_HIT_AT_MS)).toBe('hit');
    expect(DEMO_HIT_AT_MS).toBeLessThan(DEMO_TOTAL_MS);
  });

  it('only uses pick types the real flash covers', () => {
    for (const pick of demoSnapshotAtElapsed(DEMO_HIT_AT_MS).picks) {
      expect(isFlashEligible(pick)).toBe(true);
    }
  });

  it('produces the lower-third copy a real hit would', () => {
    const before = detectPickHits(
      EMPTY_PICK_HIT_TRACKER,
      demoSnapshotAtElapsed(DEMO_PRE_GAME_MS).picks,
    );
    const after = detectPickHits(before.tracker, demoSnapshotAtElapsed(DEMO_HIT_AT_MS).picks);
    expect(pickHitCopy(after.hits)?.headline).toBe('PICK HIT · 70 REC YDS');
  });

  it('keeps the same array between ticks that change nothing', () => {
    expect(demoSnapshotAtElapsed(DEMO_HIT_AT_MS)).toBe(demoSnapshotAtElapsed(DEMO_HIT_AT_MS + 500));
  });
});

describe('demo live game situation', () => {
  function liveAt(elapsed: number): DemoLiveGame {
    const live = demoSnapshotAtElapsed(elapsed).live;
    if (!live) throw new Error(`no live game at ${elapsed}ms`);
    return live;
  }

  const liveElapsed = (): number[] => {
    const out: number[] = [];
    for (let elapsed = DEMO_PRE_GAME_MS; elapsed < DEMO_TOTAL_MS; elapsed += 500) {
      out.push(elapsed);
    }
    return out;
  };

  it('has no live game before kickoff and one for the whole live phase', () => {
    expect(demoSnapshotAtElapsed(0).live).toBeNull();
    expect(demoSnapshotAtElapsed(DEMO_PRE_GAME_MS - 1).live).toBeNull();
    for (const elapsed of liveElapsed()) {
      expect(demoSnapshotAtElapsed(elapsed).live).not.toBeNull();
    }
  });

  it('only ever puts a fictional team on the ball, and the field position names one', () => {
    const abbrs = [DEMO_HOME_TEAM.abbr, DEMO_AWAY_TEAM.abbr] as string[];
    for (const elapsed of liveElapsed()) {
      const live = liveAt(elapsed);
      expect(abbrs).toContain(live.possession_team);
      expect(live.down).toBeGreaterThanOrEqual(1);
      expect(live.down).toBeLessThanOrEqual(4);
      expect(live.distance).toBeGreaterThan(0);
      expect(live.yards_to_endzone).toBeGreaterThan(0);
      expect(live.yards_to_endzone).toBeLessThan(100);
      const line = demoPossessionLine(live);
      expect(line.startsWith(`${live.possession_team} ball · `)).toBe(true);
      expect(abbrs).toContain(line.split(' · ')[2]?.split(' ')[0]);
    }
  });

  it('advances the clock and never lowers a score', () => {
    let previous = liveAt(DEMO_PRE_GAME_MS);
    for (const elapsed of liveElapsed()) {
      const live = liveAt(elapsed);
      expect(live.time_remaining_sec).toBeLessThanOrEqual(previous.time_remaining_sec);
      expect(live.score.home).toBeGreaterThanOrEqual(previous.score.home);
      expect(live.score.away).toBeGreaterThanOrEqual(previous.score.away);
      previous = live;
    }
    expect(liveAt(DEMO_HIT_AT_MS).time_remaining_sec).toBeLessThan(
      liveAt(DEMO_PRE_GAME_MS).time_remaining_sec,
    );
    expect(liveAt(DEMO_HIT_AT_MS).score.home).toBeGreaterThan(liveAt(DEMO_PRE_GAME_MS).score.home);
  });

  it('formats the ticker and possession line the way the Home live cards do', () => {
    expect(demoTickerLine(liveAt(DEMO_PRE_GAME_MS))).toBe('LIVE · Q3 · 7:40');
    expect(demoTickerLine(liveAt(DEMO_HIT_AT_MS))).toBe('LIVE · Q3 · 4:12');
    expect(demoPossessionLine(liveAt(DEMO_PRE_GAME_MS))).toBe('CMT ball · 1st & 10 · CMT 25');
    expect(demoPossessionLine(liveAt(DEMO_PRE_GAME_MS + 10_000))).toBe(
      'CMT ball · 2nd & 7 · HBR 34',
    );
    expect(demoPossessionLine(liveAt(DEMO_HIT_AT_MS))).toBe('HBR ball · 1st & 10 · HBR 25');
  });

  it('never names a real team or player in the live row copy', () => {
    const copy = liveElapsed()
      .map((elapsed) => `${demoTickerLine(liveAt(elapsed))} ${demoPossessionLine(liveAt(elapsed))}`)
      .join(' ');
    expect(copy).not.toMatch(/\b(SEA|DAL)\b/);
    expect(copy).not.toMatch(/metcalf/i);
  });
});
