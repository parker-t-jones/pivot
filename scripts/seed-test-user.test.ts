import { describe, expect, it } from 'vitest';
import { assignRoster } from './seed-test-user.js';
import type { Position, SlotType } from '@pivot/shared';

interface RosterSpec {
  positionInLineup: string;
  slotType: SlotType;
  eligiblePositions: readonly Position[];
  isStar?: true;
}

function player(id: string, position: Position) {
  return { id, first_name: 'First', last_name: `Last${id}`, position };
}

const qbSpec: RosterSpec = { positionInLineup: 'QB', slotType: 'starter', eligiblePositions: ['QB'] };
const rb1Spec: RosterSpec = { positionInLineup: 'RB1', slotType: 'starter', eligiblePositions: ['RB'] };
const rb2Spec: RosterSpec = { positionInLineup: 'RB2', slotType: 'starter', eligiblePositions: ['RB'] };
const flexSpec: RosterSpec = {
  positionInLineup: 'FLEX',
  slotType: 'flex',
  eligiblePositions: ['RB', 'WR', 'TE'],
};
const spec: readonly RosterSpec[] = [qbSpec, rb1Spec, rb2Spec, flexSpec];

describe('assignRoster', () => {
  it('assigns the lowest-id eligible player to each spot', () => {
    const players = [
      player('p3', 'RB'),
      player('p1', 'QB'),
      player('p2', 'RB'),
      player('p4', 'WR'),
    ];
    const assignment = assignRoster(spec, players);

    expect(assignment.get(qbSpec)?.id).toBe('p1');
    expect(assignment.get(rb1Spec)?.id).toBe('p2');
    expect(assignment.get(rb2Spec)?.id).toBe('p3');
  });

  it('never assigns the same player to two spots', () => {
    const players = [player('rb1', 'RB'), player('rb2', 'RB')];
    const assignment = assignRoster(spec, players);

    expect(assignment.get(rb1Spec)?.id).toBe('rb1');
    expect(assignment.get(rb2Spec)?.id).toBe('rb2');
    // Only two RBs exist and both are used by RB1/RB2, so FLEX (RB/WR/TE) has nothing left.
    expect(assignment.has(flexSpec)).toBe(false);
  });

  it('falls through eligiblePositions in order for multi-position spots', () => {
    const players = [player('te1', 'TE'), player('wr1', 'WR')];
    const assignment = assignRoster([flexSpec], players);

    // No RB available, so it should fall through to the next eligible position (WR).
    expect(assignment.get(flexSpec)?.id).toBe('wr1');
  });

  it('leaves a spot unassigned when no eligible player is available', () => {
    const players = [player('qb1', 'QB')];
    const assignment = assignRoster(spec, players);

    expect(assignment.size).toBe(1);
    expect(assignment.has(qbSpec)).toBe(true);
  });

  it('is deterministic across repeated calls with the same input', () => {
    const players = [player('p3', 'RB'), player('p1', 'QB'), player('p2', 'RB')];
    const first = assignRoster(spec, players);
    const second = assignRoster(spec, players);

    expect(first.get(rb1Spec)?.id).toBe(second.get(rb1Spec)?.id);
    expect(first.get(rb2Spec)?.id).toBe(second.get(rb2Spec)?.id);
  });
});
