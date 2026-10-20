import { describe, expect, it } from 'vitest';

import {
  PICK_KIND_COPY,
  addPickEyebrow,
  addPickSlipPickText,
  pickKindAccess,
  pickSteps,
} from './addPickFlow';

describe('add a pick explainers', () => {
  it('states each type in one plain line', () => {
    expect(PICK_KIND_COPY.map((option) => [option.label, option.explainer])).toEqual([
      ['Spread', 'Pick a team to cover the line'],
      ['Total', 'Over or under the combined score'],
      ['Moneyline', 'Pick the winner'],
      ['Survivor', "Your weekly survivor pool pick (doesn't use a free bet)"],
    ]);
  });
});

describe('add a pick eyebrow', () => {
  it('names the step before a type is chosen', () => {
    expect(addPickEyebrow(null, 'type')).toBe('ADD A PICK · STEP 1');
    expect(pickSteps(null)).toHaveLength(5);
  });

  it('uses the chosen type’s step count', () => {
    expect(addPickEyebrow('SPREAD', 'game')).toBe('ADD A PICK · SPREAD · STEP 2 OF 5');
    expect(addPickEyebrow('TOTAL', 'line')).toBe('ADD A PICK · TOTAL · STEP 3 OF 4');
    expect(addPickEyebrow('MONEYLINE', 'confirm')).toBe('ADD A PICK · MONEYLINE · STEP 4 OF 4');
    expect(addPickEyebrow('SURVIVOR', 'team')).toBe('ADD A PICK · SURVIVOR · STEP 3 OF 4');
  });
});

describe('add a pick slip', () => {
  it('fills the pick line once the side is chosen', () => {
    expect(
      addPickSlipPickText({
        kind: null,
        team: '',
        totalSide: 'TOTAL_OVER',
        lineOk: false,
        lineText: '',
        lineInput: '',
      }),
    ).toBeNull();
    expect(
      addPickSlipPickText({
        kind: 'SPREAD',
        team: 'SEA',
        totalSide: 'TOTAL_OVER',
        lineOk: true,
        lineText: '3.5',
        lineInput: '-3.5',
      }),
    ).toBe('SEA \u22123.5');
    expect(
      addPickSlipPickText({
        kind: 'TOTAL',
        team: '',
        totalSide: 'TOTAL_UNDER',
        lineOk: true,
        lineText: '47.5',
        lineInput: '47.5',
      }),
    ).toBe('Under 47.5');
    expect(
      addPickSlipPickText({
        kind: 'SURVIVOR',
        team: 'JAX',
        totalSide: 'TOTAL_OVER',
        lineOk: false,
        lineText: '',
        lineInput: '',
      }),
    ).toBe('JAX');
  });
});

describe('add a pick free-bet cap', () => {
  it('leaves every type open for Pro and while the count is unknown', () => {
    for (const option of PICK_KIND_COPY) {
      expect(pickKindAccess(option.kind, { isPro: true, freeLeft: 0 })).toBe('open');
      expect(pickKindAccess(option.kind, { isPro: false, freeLeft: null })).toBe('open');
    }
  });

  it('keeps bet types open for a free account with bets left', () => {
    expect(pickKindAccess('SPREAD', { isPro: false, freeLeft: 2 })).toBe('open');
    expect(pickKindAccess('TOTAL', { isPro: false, freeLeft: 1 })).toBe('open');
    expect(pickKindAccess('MONEYLINE', { isPro: false, freeLeft: 1 })).toBe('open');
    expect(pickKindAccess('SURVIVOR', { isPro: false, freeLeft: 1 })).toBe('open');
  });

  it('sends a capped free account to upgrade and still allows survivor', () => {
    expect(pickKindAccess('SPREAD', { isPro: false, freeLeft: 0 })).toBe('upgrade');
    expect(pickKindAccess('TOTAL', { isPro: false, freeLeft: 0 })).toBe('upgrade');
    expect(pickKindAccess('MONEYLINE', { isPro: false, freeLeft: 0 })).toBe('upgrade');
    expect(pickKindAccess('SURVIVOR', { isPro: false, freeLeft: 0 })).toBe('open');
  });
});
