import { describe, expect, it } from 'vitest';
import { mapRosterToLineupSlots } from './roster-mapping.js';

describe('mapRosterToLineupSlots', () => {
  it('maps a standard 1QB/2RB/2WR/1TE/1FLEX/1K/1DEF league', () => {
    const rosterPositions = [
      'QB',
      'RB',
      'RB',
      'WR',
      'WR',
      'TE',
      'FLEX',
      'K',
      'DEF',
      'BN',
      'BN',
      'BN',
      'BN',
      'BN',
      'BN',
    ];
    const starters = ['qb1', 'rb1', 'rb2', 'wr1', 'wr2', 'te1', 'flex1', 'k1', 'def1'];
    const players = [...starters, 'bench1', 'bench2'];

    const slots = mapRosterToLineupSlots(rosterPositions, starters, players);

    expect(slots).toEqual([
      { externalPlayerId: 'qb1', slotType: 'starter', positionInLineup: 'QB' },
      { externalPlayerId: 'rb1', slotType: 'starter', positionInLineup: 'RB1' },
      { externalPlayerId: 'rb2', slotType: 'starter', positionInLineup: 'RB2' },
      { externalPlayerId: 'wr1', slotType: 'starter', positionInLineup: 'WR1' },
      { externalPlayerId: 'wr2', slotType: 'starter', positionInLineup: 'WR2' },
      { externalPlayerId: 'te1', slotType: 'starter', positionInLineup: 'TE' },
      { externalPlayerId: 'flex1', slotType: 'flex', positionInLineup: 'FLEX' },
      { externalPlayerId: 'k1', slotType: 'starter', positionInLineup: 'K' },
      { externalPlayerId: 'def1', slotType: 'starter', positionInLineup: 'DEF' },
      { externalPlayerId: 'bench1', slotType: 'bench', positionInLineup: 'BN' },
      { externalPlayerId: 'bench2', slotType: 'bench', positionInLineup: 'BN' },
    ]);
  });

  it('maps a superflex league, giving the second QB slot an ordinal', () => {
    const rosterPositions = [
      'QB',
      'SUPER_FLEX',
      'RB',
      'RB',
      'WR',
      'WR',
      'TE',
      'K',
      'DEF',
      'BN',
      'BN',
    ];
    const starters = ['qb1', 'qb2', 'rb1', 'rb2', 'wr1', 'wr2', 'te1', 'k1', 'def1'];
    const players = [...starters, 'bench1'];

    const slots = mapRosterToLineupSlots(rosterPositions, starters, players);

    expect(slots).toEqual([
      { externalPlayerId: 'qb1', slotType: 'starter', positionInLineup: 'QB' },
      { externalPlayerId: 'qb2', slotType: 'flex', positionInLineup: 'SUPER_FLEX' },
      { externalPlayerId: 'rb1', slotType: 'starter', positionInLineup: 'RB1' },
      { externalPlayerId: 'rb2', slotType: 'starter', positionInLineup: 'RB2' },
      { externalPlayerId: 'wr1', slotType: 'starter', positionInLineup: 'WR1' },
      { externalPlayerId: 'wr2', slotType: 'starter', positionInLineup: 'WR2' },
      { externalPlayerId: 'te1', slotType: 'starter', positionInLineup: 'TE' },
      { externalPlayerId: 'k1', slotType: 'starter', positionInLineup: 'K' },
      { externalPlayerId: 'def1', slotType: 'starter', positionInLineup: 'DEF' },
      { externalPlayerId: 'bench1', slotType: 'bench', positionInLineup: 'BN' },
    ]);
  });

  it('gives a bare position label (no ordinal) when there is only one slot of that position', () => {
    const slots = mapRosterToLineupSlots(['QB', 'BN'], ['qb1'], ['qb1']);
    expect(slots).toEqual([
      { externalPlayerId: 'qb1', slotType: 'starter', positionInLineup: 'QB' },
    ]);
  });

  it('drops IDP roster slots entirely (out of scope for v1)', () => {
    const rosterPositions = ['QB', 'LB', 'DB', 'BN'];
    const starters = ['qb1', 'lb1', 'db1'];
    const players = [...starters];

    const slots = mapRosterToLineupSlots(rosterPositions, starters, players);

    expect(slots).toEqual([
      { externalPlayerId: 'qb1', slotType: 'starter', positionInLineup: 'QB' },
    ]);
  });

  it('skips empty roster slots (Sleeper placeholder player_id "0")', () => {
    const rosterPositions = ['QB', 'RB', 'BN'];
    const starters = ['qb1', '0'];
    const players = ['qb1'];

    const slots = mapRosterToLineupSlots(rosterPositions, starters, players);

    expect(slots).toEqual([
      { externalPlayerId: 'qb1', slotType: 'starter', positionInLineup: 'QB' },
    ]);
  });

  it('treats IR/TAXI roster slots the same as bench (never produce a starter slot)', () => {
    const rosterPositions = ['QB', 'IR', 'TAXI'];
    const starters = ['qb1'];
    const players = ['qb1', 'stashed1'];

    const slots = mapRosterToLineupSlots(rosterPositions, starters, players);

    expect(slots).toEqual([
      { externalPlayerId: 'qb1', slotType: 'starter', positionInLineup: 'QB' },
      { externalPlayerId: 'stashed1', slotType: 'bench', positionInLineup: 'BN' },
    ]);
  });
});
