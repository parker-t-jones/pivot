import { describe, expect, it } from 'vitest';
import { classifyPlayType, type PlayCategory, type PlayType } from '@pivot/engine';
import {
  ESPN_UNKNOWN_PLAY_TYPE,
  OBSERVED_ESPN_TYPE_IDS,
  espnTypeIdToPlayType,
} from './espnPlayTypeMap.js';

/**
 * The full chain an ESPN id travels: raw `type.id` → normalized `PlayType` → watcher category. The
 * table's whole purpose is to make the engine's validated classification come out right, so the
 * category is what's worth asserting; checking the intermediate mapping alone would let a plausible
 * `PlayType` choice hide a wrong resumption decision.
 */
function categoryFor(typeId: string): PlayCategory {
  return classifyPlayType(espnTypeIdToPlayType(typeId));
}

describe('espnTypeIdToPlayType', () => {
  const mappings: [typeId: string, label: string, expected: PlayType][] = [
    ['2', 'End Period', 'end_period'],
    ['3', 'Pass Incompletion', 'pass'],
    ['5', 'Rush', 'run'],
    ['7', 'Sack', 'pass'],
    ['8', 'Penalty', 'no_play'],
    ['9', 'Fumble Recovery (Own)', 'run'],
    ['17', 'Blocked Punt', 'punt'],
    ['21', 'Timeout', 'timeout'],
    ['24', 'Pass Reception', 'pass'],
    ['26', 'Pass Interception Return', 'pass'],
    ['29', 'Fumble Recovery (Opponent)', 'run'],
    ['30', 'Muffed Punt Recovery (Opponent)', 'punt'],
    ['32', 'Kickoff Return Touchdown', 'kickoff'],
    ['36', 'Interception Return Touchdown', 'pass'],
    ['52', 'Punt', 'punt'],
    ['53', 'Kickoff', 'kickoff'],
    ['59', 'Field Goal Good', 'field_goal'],
    ['60', 'Field Goal Missed', 'field_goal'],
    ['65', 'End of Half', 'end_half'],
    ['66', 'End of Game', 'end_game'],
    ['67', 'Passing Touchdown', 'pass'],
    ['68', 'Rushing Touchdown', 'run'],
    ['74', 'Official Timeout', 'timeout'],
    ['75', 'Two-minute warning', 'timeout'],
    ['79', 'End of Regulation', 'end_half'],
    ['80', 'Sack Opp Fumble Recovery', 'pass'],
  ];

  it.each(mappings)('maps %s (%s) to %s', (typeId, _label, expected) => {
    expect(espnTypeIdToPlayType(typeId)).toBe(expected);
  });

  it('asserts every id the table claims to have observed', () => {
    const covered = mappings.map(([typeId]) => typeId).sort();
    expect(covered).toEqual([...OBSERVED_ESPN_TYPE_IDS].sort());
  });

  it.each(['', '1', '99', '1000', 'Rush'])('falls back on unrecognized id "%s"', (typeId) => {
    expect(espnTypeIdToPlayType(typeId)).toBe(ESPN_UNKNOWN_PLAY_TYPE);
  });
});

describe('ESPN ids through the engine classifier', () => {
  const skipAndWaitIds = ['2', '21', '74', '75'];
  const abortIds = ['65', '66', '79'];

  it.each(skipAndWaitIds)('waits through ESPN id %s', (typeId) => {
    expect(categoryFor(typeId)).toBe('SKIP_AND_WAIT');
  });

  it.each(abortIds)('cancels on ESPN id %s', (typeId) => {
    expect(categoryFor(typeId)).toBe('ABORT');
  });

  it('treats every other observed id as real action', () => {
    const stoppages = new Set([...skipAndWaitIds, ...abortIds]);
    const actionIds = OBSERVED_ESPN_TYPE_IDS.filter((typeId) => !stoppages.has(typeId));

    expect(actionIds.length).toBeGreaterThan(0);
    for (const typeId of actionIds) {
      expect(categoryFor(typeId), `ESPN id ${typeId}`).toBe('REAL_ACTION');
    }
  });

  it('fires rather than stalls on an id outside the observed taxonomy', () => {
    expect(categoryFor('4242')).toBe('REAL_ACTION');
  });
});
