import type { PickStatus } from '@pivot/shared/picks';
import { describe, expect, it } from 'vitest';

import {
  EMPTY_PICK_HIT_TRACKER,
  detectPickHits,
  isFlashEligible,
  pickHitCopy,
  type FlashPick,
  type PickHit,
  type PickHitTracker,
} from './pickHitFlash';

function prop(status: PickStatus, current?: number, id = 'p1'): FlashPick {
  return {
    id,
    subject: { type: 'PLAYER' },
    condition: { type: 'STAT_OVER', stat: 'REC_YDS' },
    label: 'D. Metcalf over 68.5 rec yds',
    progress: { status, current, line: 68.5 },
  };
}

function run(tracker: PickHitTracker, picks: FlashPick[]) {
  return detectPickHits(tracker, picks);
}

describe('detectPickHits', () => {
  it('fires once when a pick goes from LIVE to HIT between two refetches', () => {
    const first = run(EMPTY_PICK_HIT_TRACKER, [prop('live', 47)]);
    expect(first.hits).toEqual([]);

    const second = run(first.tracker, [prop('hit', 70)]);
    expect(second.hits).toEqual([
      { id: 'p1', status: 'hit', label: 'D. Metcalf over 68.5 rec yds', readout: '70 rec yds' },
    ]);

    const third = run(second.tracker, [prop('hit', 74)]);
    expect(third.hits).toEqual([]);
  });

  it('does not fire for a pick that is already HIT on the first load', () => {
    const first = run(EMPTY_PICK_HIT_TRACKER, [prop('hit', 70)]);
    expect(first.hits).toEqual([]);
    expect(run(first.tracker, [prop('hit', 70)]).hits).toEqual([]);
  });

  it('does not fire again when a stat correction drops a hit back to live and it re-clears', () => {
    let tracker = run(EMPTY_PICK_HIT_TRACKER, [prop('live', 60)]).tracker;
    tracker = run(tracker, [prop('hit', 70)]).tracker;
    tracker = run(tracker, [prop('live', 66)]).tracker;
    expect(run(tracker, [prop('hit', 71)]).hits).toEqual([]);
  });

  it('does not fire when a hit settles as won at the final', () => {
    let tracker = run(EMPTY_PICK_HIT_TRACKER, [prop('live', 60)]).tracker;
    tracker = run(tracker, [prop('hit', 70)]).tracker;
    expect(run(tracker, [prop('won', 82)]).hits).toEqual([]);
  });

  it('fires WON for an under that was live and wins at the final', () => {
    const under: FlashPick = {
      ...prop('live', 40),
      condition: { type: 'STAT_UNDER', stat: 'REC_YDS' },
    };
    const tracker = run(EMPTY_PICK_HIT_TRACKER, [under]).tracker;
    const { hits } = run(tracker, [{ ...under, progress: { status: 'won', current: 52 } }]);
    expect(hits.map((hit) => hit.status)).toEqual(['won']);
  });

  it('fires from pending, when the game kicked off and the pick hit between refetches', () => {
    const tracker = run(EMPTY_PICK_HIT_TRACKER, [prop('pending')]).tracker;
    expect(run(tracker, [prop('hit', 70)]).hits).toHaveLength(1);
  });

  it('never fires from a decided state (missed, lost, refunded)', () => {
    for (const before of ['missed', 'lost', 'tie', 'void', 'unavailable'] as const) {
      const tracker = run(EMPTY_PICK_HIT_TRACKER, [prop(before, 10)]).tracker;
      expect(run(tracker, [prop('hit', 70)]).hits).toEqual([]);
    }
  });

  it('keeps what was shown through a failed refetch that returned no rows', () => {
    let tracker = run(EMPTY_PICK_HIT_TRACKER, [prop('live', 47)]).tracker;
    tracker = run(tracker, []).tracker;
    expect(run(tracker, [prop('hit', 70)]).hits).toHaveLength(1);
  });

  it('returns every pick that hit in one refetch', () => {
    const tracker = run(EMPTY_PICK_HIT_TRACKER, [
      prop('live', 47, 'a'),
      prop('live', 50, 'b'),
      prop('live', 10, 'c'),
    ]).tracker;
    const { hits } = run(tracker, [
      prop('hit', 70, 'a'),
      prop('hit', 71, 'b'),
      prop('live', 12, 'c'),
    ]);
    expect(hits.map((hit) => hit.id)).toEqual(['a', 'b']);
  });

  it('ignores parlays, the four legacy full-game types, and survivor', () => {
    const parlay: FlashPick = {
      id: 's1',
      subject: { type: 'SLIP' },
      condition: { type: 'PARLAY' },
      legs: [prop('hit', 70)],
      progress: { status: 'live' },
    };
    const spread: FlashPick = {
      id: 'sp',
      subject: { type: 'TEAM' },
      condition: { type: 'SPREAD' },
      progress: { status: 'live', current: -3 },
    };
    const survivor: FlashPick = {
      id: 'sv',
      subject: { type: 'TEAM' },
      condition: { type: 'SURVIVOR' },
      progress: { status: 'live' },
    };
    for (const pick of [parlay, spread, survivor]) expect(isFlashEligible(pick)).toBe(false);

    const tracker = run(EMPTY_PICK_HIT_TRACKER, [parlay, spread, survivor]).tracker;
    const after = [
      { ...parlay, progress: { status: 'won' as const } },
      { ...spread, progress: { status: 'won' as const } },
      { ...survivor, progress: { status: 'won' as const } },
    ];
    expect(run(tracker, after).hits).toEqual([]);
  });

  it('includes quarter and half lines, which carry a progress line', () => {
    const quarter: FlashPick = {
      id: 'q',
      subject: { type: 'GAME' },
      condition: { type: 'TOTAL_OVER', segment: 'Q2' },
      label: 'Q2 total over 10.5',
      progress: { status: 'live', current: 7 },
    };
    expect(isFlashEligible(quarter)).toBe(true);
    const tracker = run(EMPTY_PICK_HIT_TRACKER, [quarter]).tracker;
    const { hits } = run(tracker, [{ ...quarter, progress: { status: 'hit', current: 14 } }]);
    expect(hits[0]?.readout).toBe('14 pts');
  });
});

describe('pickHitCopy', () => {
  const hit = (overrides: Partial<PickHit> = {}): PickHit => ({
    id: 'p1',
    status: 'hit',
    label: 'D. Metcalf over 68.5 rec yds',
    readout: '70 rec yds',
    ...overrides,
  });

  it('is null with no hits', () => {
    expect(pickHitCopy([])).toBeNull();
  });

  it('names the pick and the number for one hit', () => {
    expect(pickHitCopy([hit()])).toEqual({
      headline: 'PICK HIT · 70 REC YDS',
      detail: 'D. Metcalf over 68.5 rec yds',
      announcement: 'Your pick D. Metcalf over 68.5 rec yds hit.',
    });
  });

  it('drops the number for a pick that has none', () => {
    const copy = pickHitCopy([hit({ label: 'Comets to score first', readout: null })]);
    expect(copy?.headline).toBe('PICK HIT');
  });

  it('says WON for a pick that won at the final', () => {
    expect(pickHitCopy([hit({ status: 'won' })])?.headline).toBe('PICK WON · 70 REC YDS');
  });

  it('summarizes several hits as one moment', () => {
    const copy = pickHitCopy([hit(), hit({ id: 'p2' }), hit({ id: 'p3', status: 'won' })]);
    expect(copy).toEqual({
      headline: '3 PICKS HIT',
      detail: 'D. Metcalf over 68.5 rec yds and 2 more picks',
      announcement: '3 of your picks hit: D. Metcalf over 68.5 rec yds and 2 more picks.',
    });
    expect(pickHitCopy([hit(), hit({ id: 'p2' })])?.detail).toBe(
      'D. Metcalf over 68.5 rec yds and 1 more pick',
    );
  });
});
