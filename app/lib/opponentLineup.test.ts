import { describe, expect, it } from 'vitest';

import { opponentEmptyCopy, opponentHeader, opponentSectionState } from './opponentLineup';

const opponent = { starters: [{ player_id: 'p-wr' }] };

describe('opponentSectionState', () => {
  it('hides the section when tracking is off and there is no opponent', () => {
    expect(opponentSectionState(null, false)).toBe('hidden');
    expect(opponentSectionState(undefined, false)).toBe('hidden');
  });

  it('shows an empty state when tracking is on and the opponent is missing', () => {
    expect(opponentSectionState(null, true)).toBe('empty');
    expect(opponentSectionState(undefined, true)).toBe('empty');
  });

  it('shows only the hint when watchOpponent is off', () => {
    expect(opponentSectionState(opponent, false)).toBe('off');
  });

  it('lists starters when watchOpponent is on', () => {
    expect(opponentSectionState(opponent, true)).toBe('on');
    expect(opponentSectionState({ starters: [] }, true)).toBe('on');
  });

  it('lists a fixture opponent even when the league is not Sleeper', () => {
    expect(opponentSectionState(opponent, false, true)).toBe('on');
  });
});

describe('opponent empty copy and header', () => {
  it('says the matchup is syncing until a lineup sync has finished', () => {
    expect(opponentEmptyCopy(null)).toBe('Syncing your matchup…');
    expect(opponentEmptyCopy(undefined)).toBe('Syncing your matchup…');
  });

  it('says there is no opponent after a sync with no pairing', () => {
    expect(opponentEmptyCopy('2026-11-04T18:00:00Z')).toBe('No opponent this week');
  });

  it('uses the fantasy team name as the section header', () => {
    expect(opponentHeader('Silver Harbor')).toBe('vs. Silver Harbor');
    expect(opponentHeader('  ')).toBe('OPPONENT');
    expect(opponentHeader(null)).toBe('OPPONENT');
  });
});
