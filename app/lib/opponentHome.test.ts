import { describe, expect, it } from 'vitest';

import type { GameSummary } from './flagEventPayload';
import type { CurrentFlag, OpponentFlagWire } from './gameDisplay';
import {
  emptyOpponentRefresh,
  noteOpponentGameState,
  noteOpponentRefetchSettled,
  noteOpponentRefetchStarted,
  opponentChipLabel,
  rankHomeFlags,
  readOpponentFields,
  seedOpponentRedZone,
} from './opponentHome';

function game(_id: string): GameSummary {
  return {
    home_team: 'BUF',
    away_team: 'MIA',
    home_team_name: 'Bills',
    away_team_name: 'Dolphins',
    home_team_primary_color: '#00338D',
    home_team_secondary_color: '#C60C30',
    away_team_primary_color: '#008E97',
    away_team_secondary_color: '#FC4C02',
    score: { home: 14, away: 7 },
    quarter: 2,
    time_remaining_sec: 400,
    possession_team: 'BUF',
    yards_to_endzone: 8,
    down: 1,
    distance: 10,
    in_red_zone: true,
  };
}

function ownFlag(id: string, priority: number): CurrentFlag {
  return {
    game_id: id,
    priority_score: priority,
    reasons: ['offense_active'],
    flagged_players: [{ player_id: 'own', first_name: 'Josh', last_name: 'Allen', position: 'QB' }],
    game: game(id),
    recommended_action: 'switch_primary',
  };
}

function opponent(id: string, name: { first_name: string; last_name: string }): OpponentFlagWire {
  return {
    game_id: id,
    priority_score: 1,
    player_ids: [`p-${id}`],
    reasons: ['red_zone'],
    players: [{ player_id: `p-${id}`, ...name }],
  };
}

const games = new Map<string, GameSummary>([
  ['game-own', game('game-own')],
  ['game-opp', game('game-opp')],
  ['game-opp-2', game('game-opp-2')],
]);

describe('rankHomeFlags', () => {
  it('keeps own flags first and does not let an opponent flag become Now Active', () => {
    const own = ownFlag('game-own', 2);
    const ranked = rankHomeFlags(
      [own],
      [opponent('game-opp', { first_name: 'Stefon', last_name: 'Diggs' })],
      games,
    );
    expect(ranked[0]).toBe(own);
    expect(ranked[1]?.opponent_label).toBe('OPPONENT · Stefon Diggs');
    expect(ranked[1]?.opponent_label).not.toMatch(/\d|yard/i);
  });

  it('makes the first opponent flag Now Active only when there is no own flag', () => {
    const ranked = rankHomeFlags(
      [],
      [
        opponent('game-opp', { first_name: 'Stefon', last_name: 'Diggs' }),
        opponent('game-opp-2', { first_name: 'Tyreek', last_name: 'Hill' }),
      ],
      games,
    );
    expect(ranked.map((flag) => flag.game_id)).toEqual(['game-opp', 'game-opp-2']);
    expect(ranked[0]?.opponent_label).toBe('OPPONENT · Stefon Diggs');
    expect(ranked[1]?.opponent_label).toBe('OPPONENT · Tyreek Hill');
  });

  it('treats missing or empty opponent keys like today', () => {
    const own = [ownFlag('game-own', 5), ownFlag('game-opp', 2)];
    expect(readOpponentFields({})).toEqual({ opponentFlags: [], opponentGameIds: [] });
    expect(readOpponentFields({ opponent_flags: [], opponent_game_ids: [] })).toEqual({
      opponentFlags: [],
      opponentGameIds: [],
    });
    expect(rankHomeFlags(own, readOpponentFields({}).opponentFlags, games)).toEqual(own);
    expect(rankHomeFlags(own, [], games)[0]).toBe(own[0]);
  });
});

describe('opponentChipLabel', () => {
  it('names the player and nothing about the play', () => {
    expect(opponentChipLabel(['Stefon Diggs'])).toBe('OPPONENT · Stefon Diggs');
    expect(opponentChipLabel(['Stefon Diggs', 'Khalil Shakir'])).toBe(
      'OPPONENT · Stefon Diggs, Khalil Shakir',
    );
  });
});

describe('noteOpponentGameState', () => {
  const listed = seedOpponentRedZone(['game-opp'], [{ game_id: 'game-opp', in_red_zone: false }]);

  it('ignores games that are not in opponent_game_ids', () => {
    const next = noteOpponentGameState(listed, {
      gameId: 'other',
      inRedZone: true,
      nowMs: 0,
    });
    expect(next).toBe(listed);
  });

  it('records the first observation without refetching', () => {
    const next = noteOpponentGameState(emptyOpponentRefresh(['game-opp']), {
      gameId: 'game-opp',
      inRedZone: true,
      nowMs: 0,
    });
    expect(next.dueAtMs).toBeNull();
    expect(next.seenRedZone['game-opp']).toBe(true);
  });

  it('refetches only when in_red_zone flips, debounced one second', () => {
    const same = noteOpponentGameState(listed, {
      gameId: 'game-opp',
      inRedZone: false,
      nowMs: 500,
    });
    expect(same).toBe(listed);

    const flipped = noteOpponentGameState(listed, {
      gameId: 'game-opp',
      inRedZone: true,
      nowMs: 500,
    });
    expect(flipped.dueAtMs).toBe(1500);

    const again = noteOpponentGameState(flipped, {
      gameId: 'game-opp',
      inRedZone: false,
      nowMs: 800,
    });
    expect(again.dueAtMs).toBe(1800);
  });

  it('holds a second flip while a request is in flight, then debounces after it settles', () => {
    const started = noteOpponentRefetchStarted(
      noteOpponentGameState(listed, { gameId: 'game-opp', inRedZone: true, nowMs: 0 }),
    );
    expect(started.inFlight).toBe(true);
    expect(started.dueAtMs).toBeNull();

    const during = noteOpponentGameState(started, {
      gameId: 'game-opp',
      inRedZone: false,
      nowMs: 200,
    });
    expect(during.inFlight).toBe(true);
    expect(during.pending).toBe(true);
    expect(during.dueAtMs).toBeNull();

    const settled = noteOpponentRefetchSettled(during, 900);
    expect(settled.inFlight).toBe(false);
    expect(settled.dueAtMs).toBe(1900);

    const quiet = noteOpponentRefetchSettled(started, 900);
    expect(quiet.dueAtMs).toBeNull();
  });

  it('does not schedule a refetch when there are no opponent games', () => {
    const empty = emptyOpponentRefresh();
    const next = noteOpponentGameState(empty, { gameId: 'game-opp', inRedZone: true, nowMs: 0 });
    expect(next).toBe(empty);
  });
});
