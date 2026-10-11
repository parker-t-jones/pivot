import { describe, expect, it } from 'vitest';

import {
  axisPercent,
  rosterStripInputs,
  rosterStripModel,
  spreadLineModel,
  survivorBadgeModel,
  totalLineModel,
} from './stakeCards';

describe('spreadLineModel', () => {
  it('places the live marker at margin plus the line', () => {
    const model = spreadLineModel({
      line: -3.5,
      pickedSide: 'home',
      status: 'in_progress',
      score: { home: 17, away: 10 },
    });
    expect(model.phase).toBe('live');
    expect(model.marker).toEqual({ position: 3.5, clamped: false, arrow: null });
    expect(axisPercent(3.5, model.axisMin, model.axisMax)).toBeCloseTo(((3.5 + 14) / 28) * 100);
    expect(model.outcome).toBeNull();
  });

  it('clamps a marker past either end and points an arrow that way', () => {
    const high = spreadLineModel({
      line: -3,
      pickedSide: 'home',
      status: 'in_progress',
      score: { home: 40, away: 0 },
    });
    expect(high.marker).toEqual({ position: 14, clamped: true, arrow: 'high' });

    const low = spreadLineModel({
      line: -3,
      pickedSide: 'away',
      status: 'in_progress',
      score: { home: 40, away: 0 },
    });
    expect(low.marker).toEqual({ position: -14, clamped: true, arrow: 'low' });
  });

  it('grades a final as covered, pushed, or lost', () => {
    expect(
      spreadLineModel({
        line: -3.5,
        pickedSide: 'home',
        status: 'final',
        score: { home: 24, away: 20 },
      }).outcome,
    ).toBe('covered');
    expect(
      spreadLineModel({
        line: -3,
        pickedSide: 'home',
        status: 'final',
        score: { home: 20, away: 17 },
      }).outcome,
    ).toBe('pushed');
    expect(
      spreadLineModel({
        line: -3.5,
        pickedSide: 'home',
        status: 'final',
        score: { home: 17, away: 20 },
      }).outcome,
    ).toBe('lost');
  });

  it('stays on the line when there is no live score', () => {
    const model = spreadLineModel({
      line: -3.5,
      pickedSide: 'home',
      status: 'in_progress',
      score: null,
    });
    expect(model.phase).toBe('line-only');
    expect(model.marker).toBeNull();
    expect(model.outcome).toBeNull();
    expect(model.lineAt).toBe(0);
    expect(model.coverFrom).toBe(0);
    expect(model.coverTo).toBe(14);
  });
});

describe('totalLineModel', () => {
  it('shades above the line for Over and below it for Under', () => {
    const over = totalLineModel({
      line: 47.5,
      side: 'over',
      status: 'scheduled',
      score: null,
    });
    const under = totalLineModel({
      line: 47.5,
      side: 'under',
      status: 'scheduled',
      score: null,
    });
    expect(over.coverFrom).toBe(0);
    expect(over.coverTo).toBe(21);
    expect(under.coverFrom).toBe(-21);
    expect(under.coverTo).toBe(0);
  });

  it('marks a live total and grades the final for each side', () => {
    const live = totalLineModel({
      line: 47.5,
      side: 'over',
      status: 'in_progress',
      score: { home: 24, away: 20 },
    });
    expect(live.marker?.position).toBeCloseTo(24 + 20 - 47.5);
    expect(live.phase).toBe('live');

    expect(
      totalLineModel({
        line: 47.5,
        side: 'over',
        status: 'final',
        score: { home: 27, away: 24 },
      }).outcome,
    ).toBe('covered');
    expect(
      totalLineModel({
        line: 47.5,
        side: 'under',
        status: 'final',
        score: { home: 27, away: 24 },
      }).outcome,
    ).toBe('lost');
    expect(
      totalLineModel({
        line: 44,
        side: 'over',
        status: 'final',
        score: { home: 24, away: 20 },
      }).outcome,
    ).toBe('pushed');
  });

  it('clamps a total outside ±21', () => {
    const model = totalLineModel({
      line: 30,
      side: 'over',
      status: 'in_progress',
      score: { home: 40, away: 35 },
    });
    expect(model.marker).toEqual({ position: 21, clamped: true, arrow: 'high' });
  });

  it('stays on the line when the live score is missing', () => {
    const model = totalLineModel({
      line: 47.5,
      side: 'under',
      status: 'final',
      score: null,
    });
    expect(model.phase).toBe('line-only');
    expect(model.marker).toBeNull();
    expect(model.outcome).toBeNull();
  });
});

describe('survivorBadgeModel', () => {
  it('stays PICK until the game is final, then WON or LOST, and a tie is LOST', () => {
    expect(
      survivorBadgeModel({
        abbreviation: 'DET',
        pickedSide: 'home',
        status: 'in_progress',
        score: { home: 21, away: 7 },
      }).status,
    ).toBe('PICK');
    expect(
      survivorBadgeModel({
        abbreviation: 'DET',
        pickedSide: 'home',
        status: 'final',
        score: { home: 21, away: 17 },
      }).status,
    ).toBe('WON');
    expect(
      survivorBadgeModel({
        abbreviation: 'DET',
        pickedSide: 'away',
        status: 'final',
        score: { home: 21, away: 17 },
      }).status,
    ).toBe('LOST');
    expect(
      survivorBadgeModel({
        abbreviation: 'DET',
        pickedSide: 'home',
        status: 'final',
        score: { home: 20, away: 20 },
      }).status,
    ).toBe('LOST');
  });
});

describe('rosterStripModel', () => {
  it('sizes each game by its starter count and sums to 100', () => {
    expect(
      rosterStripModel([
        { key: 'a', label: 'PHI', count: 2 },
        { key: 'b', label: 'BUF', count: 2 },
      ]).map((segment) => segment.widthPercent),
    ).toEqual([50, 50]);

    const uneven = rosterStripModel([
      { key: 'a', label: 'PHI', count: 1 },
      { key: 'b', label: 'BUF', count: 3 },
    ]);
    expect(uneven.map((segment) => segment.widthPercent)).toEqual([25, 75]);

    const thirds = rosterStripModel([
      { key: 'a', label: 'PHI', count: 1 },
      { key: 'b', label: 'BUF', count: 1 },
      { key: 'c', label: 'KC', count: 1 },
    ]);
    const sum = thirds.reduce((total, segment) => total + segment.widthPercent, 0);
    expect(sum).toBe(100);
  });

  it('drops games with no starters', () => {
    expect(rosterStripModel([{ key: 'bye', label: 'BYE', count: 0 }])).toEqual([]);
  });

  it('groups starters onto their game and labels the team', () => {
    const inputs = rosterStripInputs(
      [{ teamAbbr: 'phi' }, { teamAbbr: 'PHI' }, { teamAbbr: 'BUF' }, { teamAbbr: null }],
      [
        { gameId: 'g1', home: 'PHI', away: 'DAL', kickoffLabel: 'Sun 1:00' },
        { gameId: 'g2', home: 'KC', away: 'BUF', kickoffLabel: 'Sun 4:25' },
      ],
    );
    expect(
      rosterStripModel(inputs).map((segment) => [
        segment.label,
        segment.count,
        segment.widthPercent,
      ]),
    ).toEqual([
      ['PHI', 2, (2 / 3) * 100],
      ['BUF', 1, 100 - (2 / 3) * 100],
    ]);
  });
});
