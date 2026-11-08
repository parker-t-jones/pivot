import { describe, expect, it } from 'vitest';

import {
  allTabLeagues,
  fantasyLeagueCardModel,
  isLeagueExpanded,
  liveTeamAbbrs,
  resetLeagueExpansionForTests,
  setLeagueExpanded,
} from './fantasyLeagueCard';

function slot(team: string | null, position = 'RB', slotType = 'starter') {
  return {
    slot_type: slotType,
    position_in_lineup: position,
    player: { team: team == null ? null : { abbreviation: team } },
  };
}

const league = { league_id: 'l1', platform: 'sleeper', name: 'Dynasty Bros' };

describe('fantasyLeagueCardModel', () => {
  it('reads "FANTASY · {PLATFORM}", the name, and "n starters · m live now"', () => {
    const model = fantasyLeagueCardModel({
      league,
      slots: [slot('DET'), slot('GB'), slot('KC'), slot('KC', 'BN', 'bench')],
      liveTeams: new Set(['DET', 'KC']),
    });
    expect(model).toEqual({
      leagueId: 'l1',
      eyebrow: 'FANTASY · SLEEPER',
      name: 'Dynasty Bros',
      summary: '3 starters · 2 live now',
    });
  });

  it('drops the live part when nothing is live, and is singular for one starter', () => {
    expect(
      fantasyLeagueCardModel({ league, slots: [slot('DET')], liveTeams: new Set() }).summary,
    ).toBe('1 starter');
  });

  it('does not count bench, IR, or a player with no team as live', () => {
    const model = fantasyLeagueCardModel({
      league,
      slots: [slot('DET', 'IR'), slot(null), slot('GB')],
      liveTeams: new Set(['DET']),
    });
    expect(model.summary).toBe('2 starters');
  });

  it('says so when the lineup is empty, and names a manual league', () => {
    const model = fantasyLeagueCardModel({
      league: { ...league, platform: 'manual' },
      slots: [],
      liveTeams: new Set(),
    });
    expect(model.eyebrow).toBe('FANTASY · MANUAL');
    expect(model.summary).toBe('No starters yet');
  });
});

describe('liveTeamAbbrs', () => {
  const games = [
    { game_id: 'a', status: 'in_progress', home_team: 'det', away_team: 'GB' },
    { game_id: 'b', status: 'scheduled', home_team: 'KC', away_team: 'LV' },
    { game_id: 'c', status: 'final', home_team: 'BUF', away_team: 'MIA' },
  ];

  it('includes in-progress games and live-feed games, never finals', () => {
    expect([...liveTeamAbbrs(games, [{ game_id: 'b' }, { game_id: 'c' }])].sort()).toEqual([
      'DET',
      'GB',
      'KC',
      'LV',
    ]);
  });

  it('is empty without a schedule', () => {
    expect(liveTeamAbbrs(null, [{ game_id: 'a' }]).size).toBe(0);
  });
});

describe('allTabLeagues', () => {
  const leagues = [{ league_id: 'a' }, { league_id: 'b' }, { league_id: 'c' }];

  it('shows the watched leagues in league order', () => {
    expect(allTabLeagues(leagues, ['c', 'a']).map((l) => l.league_id)).toEqual(['a', 'c']);
  });

  it('shows every league when none is watched', () => {
    expect(allTabLeagues(leagues, []).map((l) => l.league_id)).toEqual(['a', 'b', 'c']);
  });
});

describe('league expansion memory', () => {
  it('remembers each league on its own for the session', () => {
    resetLeagueExpansionForTests();
    expect(isLeagueExpanded('a')).toBe(false);
    setLeagueExpanded('a', true);
    expect(isLeagueExpanded('a')).toBe(true);
    expect(isLeagueExpanded('b')).toBe(false);
    setLeagueExpanded('a', false);
    expect(isLeagueExpanded('a')).toBe(false);
  });
});
