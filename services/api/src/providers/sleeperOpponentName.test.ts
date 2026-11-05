import { describe, expect, it } from 'vitest';

import { opponentTeamNameForOwner, sleeperOpponentTeamName } from './sleeperOpponentName.js';

describe('sleeper opponent team name', () => {
  it('uses metadata.team_name when it is set', () => {
    expect(
      sleeperOpponentTeamName({
        user_id: 'owner-1',
        display_name: 'Casey',
        metadata: { team_name: 'Silver Harbor' },
      }),
    ).toBe('Silver Harbor');
  });

  it('falls back to display_name when team_name is missing or blank', () => {
    expect(
      sleeperOpponentTeamName({
        user_id: 'owner-1',
        display_name: 'Casey Nguyen',
        metadata: { team_name: '  ' },
      }),
    ).toBe('Casey Nguyen');
    expect(
      sleeperOpponentTeamName({
        user_id: 'owner-1',
        display_name: 'Casey Nguyen',
      }),
    ).toBe('Casey Nguyen');
  });

  it('matches the opponent roster owner', () => {
    const users = [
      { user_id: 'mine', display_name: 'Me', metadata: { team_name: 'My Team' } },
      { user_id: 'opp', display_name: 'Fallback Name', metadata: { team_name: '' } },
    ];
    expect(opponentTeamNameForOwner(users, 'opp')).toBe('Fallback Name');
    expect(opponentTeamNameForOwner(users, null)).toBeNull();
  });
});
