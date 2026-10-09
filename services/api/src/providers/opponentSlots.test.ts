import { afterEach, describe, expect, it, vi } from 'vitest';
import { opponentSlotsFrom } from './opponentSlots.js';
import type { SleeperMatchup } from './sleeper-client.js';

const ROSTER_POSITIONS = ['QB', 'FLEX', 'BN'];

function pairing(): SleeperMatchup[] {
  return [
    {
      roster_id: 1,
      matchup_id: 7,
      starters: ['my-qb', 'my-flex'],
      players: ['my-qb', 'my-flex', 'my-bench'],
    },
    {
      roster_id: 2,
      matchup_id: 7,
      starters: ['opp-qb', 'opp-flex', '0'],
      players: ['opp-qb', 'opp-flex', 'opp-bench'],
    },
    {
      roster_id: 3,
      matchup_id: 8,
      starters: ['other-qb'],
      players: ['other-qb'],
    },
  ];
}

describe('opponentSlotsFrom', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the paired opponent starters and flex, not bench or another pairing', () => {
    expect(opponentSlotsFrom(pairing(), '1', { rosterPositions: ROSTER_POSITIONS })).toEqual([
      { externalPlayerId: 'opp-qb', slotType: 'starter', positionInLineup: 'QB' },
      { externalPlayerId: 'opp-flex', slotType: 'flex', positionInLineup: 'FLEX' },
    ]);
  });

  it('returns nothing on a bye week', () => {
    const matchups: SleeperMatchup[] = [
      { roster_id: 1, matchup_id: null, starters: ['my-qb'], players: ['my-qb'] },
      { roster_id: 2, matchup_id: null, starters: ['opp-qb'], players: ['opp-qb'] },
    ];
    expect(opponentSlotsFrom(matchups, '1')).toEqual([]);
  });

  it('uses roster starters when matchup starters is null and does not promote players', () => {
    const matchups: SleeperMatchup[] = [
      { roster_id: 1, matchup_id: 3, starters: ['my-qb'], players: ['my-qb'] },
      {
        roster_id: 2,
        matchup_id: 3,
        starters: null,
        players: ['opp-qb', 'opp-bench'],
      },
    ];

    expect(opponentSlotsFrom(matchups, '1', { rosterPositions: ['QB', 'BN'] })).toEqual([]);

    expect(
      opponentSlotsFrom(matchups, '1', {
        rosterPositions: ['QB', 'BN'],
        rosters: [
          {
            roster_id: 2,
            starters: ['opp-qb'],
            players: ['opp-qb', 'opp-bench'],
          },
        ],
      }),
    ).toEqual([{ externalPlayerId: 'opp-qb', slotType: 'starter', positionInLineup: 'QB' }]);
  });

  it('returns nothing when my roster is missing from the response', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(opponentSlotsFrom(pairing(), '99')).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('logs once when no other row shares the matchup', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const matchups: SleeperMatchup[] = [
      { roster_id: 1, matchup_id: 4, starters: ['my-qb'], players: ['my-qb'] },
      { roster_id: 3, matchup_id: 9, starters: ['other-qb'], players: ['other-qb'] },
    ];
    expect(opponentSlotsFrom(matchups, '1')).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('[stakes] no opponent matchup roster=1 matchup_id=4');
  });
});
