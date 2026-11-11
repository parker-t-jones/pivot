import { describe, expect, it } from 'vitest';

import { flagEventPayload } from '../fixtures/flagEvent.testFixture';
import {
  DEMO_ACTIVE_AT_MS,
  DEMO_ALERT_MAX_SPACING_MS,
  DEMO_ALERT_MIN_SPACING_MS,
  DEMO_ALERT_VISIBLE_MS,
  DEMO_ALERTS,
  DEMO_AWAY_TEAM,
  DEMO_CLOSING_AT_MS,
  DEMO_COUNTDOWN_START,
  DEMO_COUNTDOWN_TICK_MS,
  DEMO_HIT_AT_MS,
  DEMO_HOME_TEAM,
  DEMO_LIVE_MS,
  DEMO_PRE_GAME_MS,
  DEMO_REC_YDS,
  DEMO_TOTAL_MS,
  DEMO_WATCH_HINT,
  DEMO_WATCH_LABEL,
  demoAlertsToPresent,
  demoCountdownAtElapsed,
  demoLiveStakeCards,
  demoPhaseAtElapsed,
  demoSnapshotAtElapsed,
  isDemoNotificationData,
  type DemoAlertKind,
  type DemoLiveGame,
} from './demoGameDay';
import {
  downDistanceLabel,
  fieldGaugeMarkerPercent,
  fieldGaugeShowsRedZone,
  fieldPositionLabel,
  gameClockLine,
} from './gameDisplay';
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

const propOf = (elapsed: number) => {
  const prop = demoSnapshotAtElapsed(elapsed).picks.find((pick) => pick.id === 'demo-prop');
  if (!prop) throw new Error('no demo prop');
  return prop;
};

describe('isDemoNotificationData', () => {
  it('rejects a real flag-event payload', () => {
    expect(isDemoNotificationData(flagEventPayload)).toBe(false);
  });

  it.each(DEMO_ALERTS)('recognizes the $kind demo notification', ({ kind }) => {
    expect(isDemoNotificationData({ demo: true, kind })).toBe(true);
  });

  it.each([
    {},
    null,
    undefined,
    'demo',
    { demo: 'true', kind: 'active' },
    { demo: true },
    { demo: true, kind: 'unknown' },
    { demo: true, kind: null },
    { demo: false, kind: 'active' },
    { kind: 'active' },
  ])('rejects unrecognized data: %j', (data) => {
    expect(isDemoNotificationData(data)).toBe(false);
  });
});

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

describe('sped-up countdown', () => {
  it('starts at 10 and a displayed second is 600ms of real time', () => {
    expect(DEMO_COUNTDOWN_START).toBe(10);
    expect(DEMO_COUNTDOWN_TICK_MS).toBe(600);
    expect(demoCountdownAtElapsed(0)).toBe(10);
  });

  it('lasts about 6s of real time, then reads 0 once live', () => {
    expect(DEMO_PRE_GAME_MS).toBe(6_000);
    expect(demoCountdownAtElapsed(DEMO_PRE_GAME_MS - 1)).toBe(1);
    expect(demoCountdownAtElapsed(DEMO_PRE_GAME_MS)).toBe(0);
    expect(demoCountdownAtElapsed(DEMO_PRE_GAME_MS + 10_000)).toBe(0);
  });

  it('steps down by exactly one at each 600ms and never skips a number', () => {
    const seen: number[] = [];
    for (let elapsed = 0; elapsed < DEMO_PRE_GAME_MS; elapsed += 100) {
      const value = demoCountdownAtElapsed(elapsed);
      if (seen[seen.length - 1] !== value) seen.push(value);
    }
    expect(seen).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(demoCountdownAtElapsed(DEMO_COUNTDOWN_TICK_MS - 1)).toBe(10);
    expect(demoCountdownAtElapsed(DEMO_COUNTDOWN_TICK_MS)).toBe(9);
  });

  it('never goes negative or above the start for an out-of-range elapsed', () => {
    expect(demoCountdownAtElapsed(-5_000)).toBe(DEMO_COUNTDOWN_START);
    expect(demoCountdownAtElapsed(1e9)).toBe(0);
  });
});

describe('demo length', () => {
  it('is about 30s: countdown, three beats, a short hold', () => {
    expect(DEMO_TOTAL_MS).toBeGreaterThanOrEqual(28_000);
    expect(DEMO_TOTAL_MS).toBeLessThanOrEqual(32_000);
    expect(DEMO_LIVE_MS).toBe(DEMO_TOTAL_MS - DEMO_PRE_GAME_MS);
    expect(DEMO_TOTAL_MS).toBeGreaterThan(DEMO_HIT_AT_MS);
  });
});

describe('the three alerts', () => {
  it('are active, closing in, hit, in that order', () => {
    expect(DEMO_ALERTS.map((alert) => alert.kind)).toEqual(['active', 'closing', 'hit']);
    expect(DEMO_ALERTS.map((alert) => alert.atMs)).toEqual([
      DEMO_ACTIVE_AT_MS,
      DEMO_CLOSING_AT_MS,
      DEMO_HIT_AT_MS,
    ]);
  });

  it('are 6 to 12s apart, never closer, never farther', () => {
    for (let i = 1; i < DEMO_ALERTS.length; i += 1) {
      const gap = (DEMO_ALERTS[i]?.atMs ?? 0) - (DEMO_ALERTS[i - 1]?.atMs ?? 0);
      expect(gap).toBeGreaterThanOrEqual(DEMO_ALERT_MIN_SPACING_MS);
      expect(gap).toBeLessThanOrEqual(DEMO_ALERT_MAX_SPACING_MS);
    }
    expect(DEMO_ALERT_MIN_SPACING_MS).toBe(6_000);
    expect(DEMO_ALERT_MAX_SPACING_MS).toBe(12_000);
  });

  it('are evenly spaced', () => {
    const gaps = DEMO_ALERTS.slice(1).map((alert, i) => alert.atMs - (DEMO_ALERTS[i]?.atMs ?? 0));
    expect(new Set(gaps).size).toBe(1);
  });

  it('fire as the demo goes live, and the banner is gone before the next one', () => {
    expect(DEMO_ALERTS[0]?.atMs).toBe(DEMO_PRE_GAME_MS);
    expect(DEMO_ALERT_VISIBLE_MS).toBeLessThan(DEMO_ALERT_MIN_SPACING_MS);
  });

  it('fall inside the demo, each with time left to read it', () => {
    for (const alert of DEMO_ALERTS) {
      expect(alert.atMs).toBeLessThan(DEMO_TOTAL_MS);
    }
    expect(DEMO_TOTAL_MS - DEMO_HIT_AT_MS).toBeGreaterThanOrEqual(DEMO_ALERT_VISIBLE_MS);
  });

  it('match the card at the instant each one fires', () => {
    const [active, closing, hit] = DEMO_ALERTS;
    expect(propOf(DEMO_ACTIVE_AT_MS).progress).toMatchObject({
      status: 'live',
      current: DEMO_REC_YDS.active,
      line: 68.5,
    });
    expect(propOf(DEMO_CLOSING_AT_MS).progress).toMatchObject({
      status: 'live',
      current: DEMO_REC_YDS.closing,
      line: 68.5,
    });
    expect(propOf(DEMO_HIT_AT_MS).progress).toMatchObject({
      status: 'hit',
      current: DEMO_REC_YDS.hit,
      line: 68.5,
    });
    expect(closing?.body).toContain(`${DEMO_REC_YDS.closing} of 68.5`);
    expect(hit?.body).toContain(`${DEMO_REC_YDS.hit} yards`);
    expect(hit?.body).toContain('68.5');
    // The nudge reveals nothing: no number at all.
    expect(active?.body).not.toMatch(/\d/);
  });

  it('step the card up: 47, then 62 of 68.5, then the hit at 70', () => {
    expect(DEMO_REC_YDS.active).toBeLessThan(DEMO_REC_YDS.closing);
    expect(DEMO_REC_YDS.closing).toBeLessThan(68.5);
    expect(DEMO_REC_YDS.hit).toBeGreaterThan(68.5);
    // Changes at the alert time exactly, not a tick before or after.
    expect(propOf(DEMO_CLOSING_AT_MS - 1).progress).toMatchObject({ current: DEMO_REC_YDS.active });
    expect(propOf(DEMO_HIT_AT_MS - 1).progress).toMatchObject({ current: DEMO_REC_YDS.closing });
  });

  it('make the hit snapshot coincide with the third alert', () => {
    expect(propOf(DEMO_HIT_AT_MS - 1).progress.status).toBe('live');
    expect(propOf(DEMO_HIT_AT_MS).progress.status).toBe('hit');
    expect(DEMO_ALERTS[2]?.atMs).toBe(DEMO_HIT_AT_MS);
  });

  it('are labeled as demos and say "pick", with fictional names only', () => {
    for (const alert of DEMO_ALERTS) {
      expect(alert.title.toLowerCase()).toContain('demo');
      const copy = `${alert.title} ${alert.body}`;
      expect(copy.toLowerCase()).toContain('pick');
      expect(copy).not.toMatch(/stake/i);
      expect(copy).not.toMatch(/odds|bet|wager|edge|ahead|broadcast/i);
      expect(copy).not.toMatch(/\b(SEA|DAL)\b/);
      expect(copy).not.toMatch(/metcalf/i);
    }
  });
});

describe('demoAlertsToPresent', () => {
  const none = new Set<DemoAlertKind>();

  it('has nothing due before the first alert', () => {
    expect(demoAlertsToPresent({ elapsedMs: 0, handled: none, osSpans: [] })).toEqual({
      due: [],
      show: [],
    });
    expect(
      demoAlertsToPresent({ elapsedMs: DEMO_ACTIVE_AT_MS - 1, handled: none, osSpans: [] }).due,
    ).toEqual([]);
  });

  it('shows each alert at its own time, once', () => {
    const handled = new Set<DemoAlertKind>();
    const fired: DemoAlertKind[] = [];
    for (let elapsed = 0; elapsed <= DEMO_TOTAL_MS; elapsed += 200) {
      const { due, show } = demoAlertsToPresent({ elapsedMs: elapsed, handled, osSpans: [] });
      for (const alert of due) handled.add(alert.kind);
      for (const alert of show) {
        fired.push(alert.kind);
        expect(elapsed - alert.atMs).toBeLessThan(200);
      }
    }
    expect(fired).toEqual(['active', 'closing', 'hit']);
  });

  it('does not re-show an alert the OS delivered while the app was backgrounded', () => {
    const { due, show } = demoAlertsToPresent({
      elapsedMs: DEMO_HIT_AT_MS + 200,
      handled: new Set<DemoAlertKind>(['active']),
      osSpans: [{ fromMs: DEMO_CLOSING_AT_MS - 2_000, toMs: DEMO_HIT_AT_MS + 100 }],
    });
    expect(due.map((alert) => alert.kind)).toEqual(['closing', 'hit']);
    expect(show).toEqual([]);
  });

  it('still shows an alert outside the backgrounded stretch', () => {
    const { show } = demoAlertsToPresent({
      elapsedMs: DEMO_HIT_AT_MS + 200,
      handled: new Set<DemoAlertKind>(['active']),
      osSpans: [{ fromMs: DEMO_CLOSING_AT_MS - 2_000, toMs: DEMO_CLOSING_AT_MS + 1_000 }],
    });
    expect(show.map((alert) => alert.kind)).toEqual(['hit']);
  });
});

describe('demo fixture copy', () => {
  it('never names a real NFL team, in the slate or the alerts', () => {
    const haystack = [
      DEMO_HOME_TEAM.name,
      DEMO_AWAY_TEAM.name,
      ...DEMO_ALERTS.flatMap((alert) => [alert.title, alert.body]),
      ...demoSnapshotAtElapsed(DEMO_HIT_AT_MS).picks.map((pick) => pick.label),
    ]
      .join(' ')
      .toLowerCase();
    for (const team of REAL_NFL_TEAM_NAMES) {
      expect(haystack).not.toContain(team);
    }
  });
});

describe('demo pick timeline', () => {
  /** Every tick of the demo, 200ms apart, as the screen feeds them to `usePickHitFlash`. */
  function ticks(): ReturnType<typeof demoSnapshotAtElapsed>[] {
    const out = [];
    for (let elapsed = 0; elapsed <= DEMO_TOTAL_MS; elapsed += 200) {
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
    const status = (elapsed: number) => propOf(elapsed).progress.status;
    expect(status(0)).toBe('pending');
    expect(status(DEMO_PRE_GAME_MS)).toBe('live');
    expect(status(DEMO_HIT_AT_MS - 1)).toBe('live');
    expect(status(DEMO_HIT_AT_MS)).toBe('hit');
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
    expect(demoSnapshotAtElapsed(DEMO_HIT_AT_MS)).toBe(demoSnapshotAtElapsed(DEMO_HIT_AT_MS + 200));
  });
});

describe('demo live game', () => {
  function liveAt(elapsed: number): DemoLiveGame {
    const live = demoSnapshotAtElapsed(elapsed).live;
    if (!live) throw new Error(`no live game at ${elapsed}ms`);
    return live;
  }

  it('has no live game before kickoff and one for the whole live phase', () => {
    expect(demoSnapshotAtElapsed(0).live).toBeNull();
    expect(demoSnapshotAtElapsed(DEMO_PRE_GAME_MS - 1).live).toBeNull();
    for (let elapsed = DEMO_PRE_GAME_MS; elapsed < DEMO_TOTAL_MS; elapsed += 200) {
      expect(demoSnapshotAtElapsed(elapsed).live).not.toBeNull();
    }
  });

  it('advances the clock and never lowers a score', () => {
    let previous = liveAt(DEMO_PRE_GAME_MS);
    for (let elapsed = DEMO_PRE_GAME_MS; elapsed < DEMO_TOTAL_MS; elapsed += 200) {
      const live = liveAt(elapsed);
      expect(live.time_remaining_sec).toBeLessThanOrEqual(previous.time_remaining_sec);
      expect(live.score.home).toBeGreaterThanOrEqual(previous.score.home);
      expect(live.score.away).toBeGreaterThanOrEqual(previous.score.away);
      previous = live;
    }
    expect(liveAt(DEMO_HIT_AT_MS).score.home).toBeGreaterThan(liveAt(DEMO_PRE_GAME_MS).score.home);
  });
});

describe('demo field situation (the Home hero gauge)', () => {
  const beats = [
    { name: 'active', at: DEMO_ACTIVE_AT_MS },
    { name: 'closing', at: DEMO_CLOSING_AT_MS },
    { name: 'hit', at: DEMO_HIT_AT_MS },
  ] as const;
  const liveOf = (elapsed: number): DemoLiveGame => {
    const live = demoSnapshotAtElapsed(elapsed).live;
    if (!live) throw new Error(`no live game at ${elapsed}ms`);
    return live;
  };

  it('moves the gauge marker up the field with each beat: own 25, HBR 34, HBR 2', () => {
    const percents = beats.map((beat) => {
      const live = liveOf(beat.at);
      expect(live.yards_to_endzone).not.toBeNull();
      return fieldGaugeMarkerPercent(live.yards_to_endzone ?? 0);
    });
    expect(percents).toEqual([25, 66, 98]);
    const labels = beats.map((beat) => {
      const live = liveOf(beat.at);
      return fieldPositionLabel(live.yards_to_endzone, live.possession_team, DEMO_AWAY_TEAM.abbr);
    });
    expect(labels).toEqual(['CMT 25', 'HBR 34', 'HBR 2']);
  });

  it('carries down and distance, then none for the extra point after the touchdown catch', () => {
    const lines = beats.map((beat) => {
      const live = liveOf(beat.at);
      return downDistanceLabel(live.down, live.distance);
    });
    expect(lines).toEqual(['1st & 10', '2nd & 7', null]);
  });

  it('reads the clock line the gauge prints at each beat', () => {
    const lines = beats.map((beat) => {
      const live = liveOf(beat.at);
      return gameClockLine(
        live.quarter,
        live.time_remaining_sec,
        live.down,
        live.distance,
        live.possession_team,
      );
    });
    expect(lines).toEqual(['Q3 · 7:40 · 1st & 10', 'Q3 · 5:55 · 2nd & 7', 'Q3 · 4:12']);
  });

  it('keeps CMT on the ball and the yard line on the field for the whole live phase', () => {
    for (let elapsed = DEMO_PRE_GAME_MS; elapsed < DEMO_TOTAL_MS; elapsed += 200) {
      const live = liveOf(elapsed);
      expect(live.possession_team).toBe(DEMO_HOME_TEAM.abbr);
      expect([live.home_team, live.away_team]).toEqual([DEMO_HOME_TEAM.abbr, DEMO_AWAY_TEAM.abbr]);
      expect(live.yards_to_endzone).toBeGreaterThanOrEqual(0);
      expect(live.yards_to_endzone).toBeLessThanOrEqual(100);
      expect(live.in_red_zone).toBe(fieldGaugeShowsRedZone(live.yards_to_endzone ?? 100));
    }
  });

  it('only shows RED ZONE on the last beat', () => {
    expect(beats.map((beat) => liveOf(beat.at).in_red_zone)).toEqual([false, false, true]);
  });

  it('steps the score with the beats: 10-7, 10-7, then 17-7', () => {
    expect(beats.map((beat) => liveOf(beat.at).score)).toEqual([
      { home: 10, away: 7 },
      { home: 10, away: 7 },
      { home: 17, away: 7 },
    ]);
  });

  it('uses only neutral team colors, never a real team color', () => {
    const live = liveOf(DEMO_ACTIVE_AT_MS);
    expect(live.home_team_primary_color).toBe(live.away_team_primary_color);
    expect(live.home_team_secondary_color).toBe(live.away_team_secondary_color);
  });
});

describe('demoLiveStakeCards (the Home hero model)', () => {
  it('has no card before kickoff', () => {
    expect(demoLiveStakeCards(demoSnapshotAtElapsed(0).live)).toEqual([]);
  });

  it('builds one NOW ACTIVE card at every beat, with the player on field and the demo button', () => {
    for (const elapsed of [DEMO_ACTIVE_AT_MS, DEMO_CLOSING_AT_MS, DEMO_HIT_AT_MS]) {
      const cards = demoLiveStakeCards(demoSnapshotAtElapsed(elapsed).live);
      expect(cards).toHaveLength(1);
      const card = cards[0];
      expect(card?.game.game_id).toBe('demo-game');
      expect(card?.eyebrow).toBe('NOW ACTIVE');
      expect(card?.active).toBe(true);
      expect(card?.chips.map((chip) => chip.text)).toEqual(['R. Vance WR · ON FIELD']);
      expect(card?.chips[0]?.tone).toBe('on_field');
      expect(card?.buttonLabel).toBe(DEMO_WATCH_LABEL);
      expect(card?.opensLink).toBe(true);
    }
  });

  it('carries the live game of its beat, so the card score and gauge advance', () => {
    const first = demoLiveStakeCards(demoSnapshotAtElapsed(DEMO_ACTIVE_AT_MS).live)[0];
    const last = demoLiveStakeCards(demoSnapshotAtElapsed(DEMO_HIT_AT_MS).live)[0];
    expect(first?.game.score).toEqual({ home: 10, away: 7 });
    expect(last?.game.score).toEqual({ home: 17, away: 7 });
    expect(last?.game.yards_to_endzone).toBe(2);
  });

  it('names no real service, team or betting term in the button, hint or chips', () => {
    const card = demoLiveStakeCards(demoSnapshotAtElapsed(DEMO_ACTIVE_AT_MS).live)[0];
    const text = [DEMO_WATCH_LABEL, DEMO_WATCH_HINT, ...(card?.chips.map((c) => c.text) ?? [])]
      .join(' ')
      .toLowerCase();
    for (const word of [
      'youtube',
      'hulu',
      'fubo',
      'sling',
      'directv',
      'espn',
      'peacock',
      'prime',
      'paramount',
      'sunday ticket',
      'edge',
      'odds',
      'bet',
      'stake',
    ]) {
      expect(text).not.toContain(word);
    }
    for (const team of REAL_NFL_TEAM_NAMES) expect(text).not.toContain(team);
  });
});
