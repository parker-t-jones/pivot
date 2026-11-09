import { describe, expect, it } from 'vitest';

import {
  LEG_KIND_COPY,
  PICK_KIND_COPY,
  kindAllowsLive,
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
      ['Player prop', 'Over or under a player stat, or a touchdown scorer'],
      ['Team & game props', 'Team totals, quarters and halves, first to score, field goals'],
      ['Parlay', 'Two or more picks saved as one (uses one free bet)'],
      ['Survivor', "Your weekly survivor pool pick (doesn't use a free bet)"],
    ]);
  });
});

describe('add a pick eyebrow', () => {
  it('names the step before a type is chosen', () => {
    expect(addPickEyebrow(null, 'type')).toBe('ADD A PICK · STEP 1');
    expect(pickSteps(null)).toHaveLength(4);
  });

  it('uses the chosen type’s step count', () => {
    expect(addPickEyebrow('SPREAD', 'game')).toBe('ADD A PICK · SPREAD · STEP 2 OF 4');
    expect(addPickEyebrow('TOTAL', 'line')).toBe('ADD A PICK · TOTAL · STEP 3 OF 4');
    expect(addPickEyebrow('MONEYLINE', 'confirm')).toBe('ADD A PICK · MONEYLINE · STEP 3 OF 3');
    expect(addPickEyebrow('SURVIVOR', 'confirm')).toBe('ADD A PICK · SURVIVOR · STEP 3 OF 3');
    expect(addPickEyebrow('PLAYER_PROP', 'market')).toBe('ADD A PICK · PLAYER PROP · STEP 3 OF 5');
    expect(addPickEyebrow('TEAM_PROP', 'game', { teamMarket: 'TEAM_TOTAL' })).toBe(
      'ADD A PICK · TEAM & GAME PROP · STEP 3 OF 5',
    );
    expect(addPickEyebrow('TEAM_PROP', 'confirm', { teamMarket: 'FIRST_TO_SCORE' })).toBe(
      'ADD A PICK · TEAM & GAME PROP · STEP 4 OF 4',
    );
  });

  it('names the parlay and the leg being built', () => {
    expect(addPickEyebrow(null, 'legs', { parlayLeg: 1 })).toBe('ADD A PICK · PARLAY');
    expect(addPickEyebrow(null, 'type', { parlayLeg: 2 })).toBe('ADD A PICK · PARLAY · LEG 2');
    expect(addPickEyebrow('SPREAD', 'line', { parlayLeg: 2 })).toBe(
      'ADD A PICK · PARLAY · LEG 2 · STEP 3 OF 4',
    );
  });

  it('takes a player prop’s game from the player and gives first to score no line step', () => {
    expect(pickSteps('PLAYER_PROP')).toEqual(['type', 'player', 'market', 'line', 'confirm']);
    expect(pickSteps('TEAM_PROP', 'FIRST_TO_SCORE')).toEqual(['type', 'market', 'game', 'confirm']);
    expect(pickSteps('TEAM_PROP', 'SEGMENT_TOTAL')).toEqual([
      'type',
      'market',
      'game',
      'line',
      'confirm',
    ]);
  });

  it('offers every type but survivor and parlay as a parlay leg', () => {
    expect(LEG_KIND_COPY.map((option) => option.kind)).toEqual([
      'SPREAD',
      'TOTAL',
      'MONEYLINE',
      'PLAYER_PROP',
      'TEAM_PROP',
    ]);
  });

  it('opens games in progress to every bet and not to survivor', () => {
    expect(kindAllowsLive('PLAYER_PROP')).toBe(true);
    expect(kindAllowsLive('PARLAY')).toBe(true);
    expect(kindAllowsLive('SPREAD')).toBe(true);
    expect(kindAllowsLive('SURVIVOR')).toBe(false);
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

  it('caps props and parlays like any other bet', () => {
    for (const kind of ['PLAYER_PROP', 'TEAM_PROP', 'PARLAY'] as const) {
      expect(pickKindAccess(kind, { isPro: false, freeLeft: 1 })).toBe('open');
      expect(pickKindAccess(kind, { isPro: false, freeLeft: 0 })).toBe('upgrade');
    }
  });
});
