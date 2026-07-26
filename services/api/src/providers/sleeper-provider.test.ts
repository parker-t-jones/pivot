import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleeperClient } from './sleeper-client.js';
import { SleeperProvider } from './sleeper-provider.js';

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 404,
    statusText: ok ? 'OK' : 'Not Found',
    json: async () => body,
  } as Response;
}

describe('SleeperProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('supports sync', () => {
    expect(new SleeperProvider().supportsSync()).toBe(true);
  });

  describe('resolveLeagueConnection', () => {
    it('resolves the owned roster for a Sleeper username in a league', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ user_id: 'user-abc', username: 'parker' }))
        .mockResolvedValueOnce(
          jsonResponse({
            league_id: 'league-1',
            name: 'The League',
            season: '2026',
            roster_positions: [],
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse([
            { roster_id: 1, owner_id: 'someone-else', starters: [], players: [] },
            { roster_id: 2, owner_id: 'user-abc', starters: [], players: [] },
          ]),
        );

      const connection = await new SleeperProvider().resolveLeagueConnection('parker', 'league-1');

      expect(connection).toEqual({
        externalLeagueId: 'league-1',
        externalOwnerId: 'user-abc',
        externalRosterId: '2',
        name: 'The League',
        seasonYear: 2026,
      });
    });

    it('throws sleeper_user_not_found when the username does not resolve', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(null));

      await expect(
        new SleeperProvider().resolveLeagueConnection('nobody', 'league-1'),
      ).rejects.toMatchObject({ statusCode: 404, code: 'sleeper_user_not_found' });
    });

    it('throws sleeper_roster_not_found when the user owns no roster in the league', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ user_id: 'user-abc', username: 'parker' }))
        .mockResolvedValueOnce(
          jsonResponse({
            league_id: 'league-1',
            name: 'The League',
            season: '2026',
            roster_positions: [],
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse([{ roster_id: 1, owner_id: 'someone-else', starters: [], players: [] }]),
        );

      await expect(
        new SleeperProvider().resolveLeagueConnection('parker', 'league-1'),
      ).rejects.toMatchObject({ statusCode: 404, code: 'sleeper_roster_not_found' });
    });
  });

  describe('fetchLineup', () => {
    const league = {
      league_id: 'league-1',
      name: 'The League',
      season: '2026',
      roster_positions: ['QB', 'BN'],
    };

    it('uses matchup starters/players when a matching matchup exists and does not call getLeagueRosters', async () => {
      vi.spyOn(sleeperClient, 'getLeague').mockResolvedValue(league);
      vi.spyOn(sleeperClient, 'getLeagueMatchups').mockResolvedValue([
        { roster_id: 1, starters: ['other-qb'], players: ['other-qb'] },
        { roster_id: 2, starters: ['qb1'], players: ['qb1', 'bench1'] },
      ]);
      const getLeagueRosters = vi.spyOn(sleeperClient, 'getLeagueRosters');

      const slots = await new SleeperProvider().fetchLineup({
        externalLeagueId: 'league-1',
        externalRosterId: '2',
        week: 5,
      });

      expect(slots).toEqual([
        { externalPlayerId: 'qb1', slotType: 'starter', positionInLineup: 'QB' },
        { externalPlayerId: 'bench1', slotType: 'bench', positionInLineup: 'BN' },
      ]);
      expect(getLeagueRosters).not.toHaveBeenCalled();
    });

    it('falls back to getLeagueRosters when matchups are empty (offseason)', async () => {
      vi.spyOn(sleeperClient, 'getLeague').mockResolvedValue(league);
      vi.spyOn(sleeperClient, 'getLeagueMatchups').mockResolvedValue([]);
      const getLeagueRosters = vi.spyOn(sleeperClient, 'getLeagueRosters').mockResolvedValue([
        {
          roster_id: 2,
          owner_id: 'user-abc',
          starters: ['qb1'],
          players: ['qb1', 'bench1'],
        },
      ]);

      const slots = await new SleeperProvider().fetchLineup({
        externalLeagueId: 'league-1',
        externalRosterId: '2',
        week: 0,
      });

      expect(slots).toEqual([
        { externalPlayerId: 'qb1', slotType: 'starter', positionInLineup: 'QB' },
        { externalPlayerId: 'bench1', slotType: 'bench', positionInLineup: 'BN' },
      ]);
      expect(getLeagueRosters).toHaveBeenCalledWith('league-1');
    });

    it('falls back to getLeagueRosters when matchups exist but no roster_id matches', async () => {
      vi.spyOn(sleeperClient, 'getLeague').mockResolvedValue(league);
      vi.spyOn(sleeperClient, 'getLeagueMatchups').mockResolvedValue([
        { roster_id: 1, starters: ['other-qb'], players: ['other-qb'] },
      ]);
      vi.spyOn(sleeperClient, 'getLeagueRosters').mockResolvedValue([
        {
          roster_id: 2,
          owner_id: 'user-abc',
          starters: ['qb1'],
          players: ['qb1', 'bench1'],
        },
      ]);

      const slots = await new SleeperProvider().fetchLineup({
        externalLeagueId: 'league-1',
        externalRosterId: '2',
        week: 5,
      });

      expect(slots).toEqual([
        { externalPlayerId: 'qb1', slotType: 'starter', positionInLineup: 'QB' },
        { externalPlayerId: 'bench1', slotType: 'bench', positionInLineup: 'BN' },
      ]);
    });

    it('throws sleeper_roster_not_found when neither matchup nor roster matches', async () => {
      vi.spyOn(sleeperClient, 'getLeague').mockResolvedValue(league);
      vi.spyOn(sleeperClient, 'getLeagueMatchups').mockResolvedValue([]);
      vi.spyOn(sleeperClient, 'getLeagueRosters').mockResolvedValue([
        { roster_id: 1, owner_id: 'someone-else', starters: [], players: [] },
      ]);

      await expect(
        new SleeperProvider().fetchLineup({
          externalLeagueId: 'league-1',
          externalRosterId: '2',
          week: 0,
        }),
      ).rejects.toMatchObject({ statusCode: 404, code: 'sleeper_roster_not_found' });
    });
  });
});
