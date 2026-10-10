import { describe, expect, it } from 'vitest';

import type { GameSummary } from './flagEventPayload';
import type { CurrentFlag } from './gameDisplay';
import { betChipLabel, betEventRequestsRefetch, readBetGameIds } from './homeBets';
import { rankHomeFlags } from './opponentHome';
import {
  emptyOpponentRefresh,
  noteBetGameState,
  noteBetInPlay,
  noteOpponentRefetchStarted,
  seedOpponentRedZone,
} from './opponentHome';

function game(): GameSummary {
  return {
    home_team: 'CHI',
    away_team: 'PHI',
    home_team_name: 'Bears',
    away_team_name: 'Eagles',
    home_team_primary_color: '#0B162A',
    home_team_secondary_color: '#C83803',
    away_team_primary_color: '#004C54',
    away_team_secondary_color: '#A5ACAF',
    score: { home: 20, away: 7 },
    quarter: 4,
    time_remaining_sec: 800,
    possession_team: 'PHI',
    yards_to_endzone: null,
    down: null,
    distance: null,
    in_red_zone: false,
  };
}

function ownFlag(): CurrentFlag {
  return {
    game_id: 'game-phi',
    priority_score: 2,
    reasons: ['offense_active'],
    flagged_players: [{ player_id: 'qb', first_name: 'Jalen', last_name: 'Hurts', position: 'QB' }],
    game: game(),
    recommended_action: 'switch_primary',
  };
}

describe('home bets', () => {
  it('keeps ranking identical when the response has no bet keys', () => {
    const flag = ownFlag();
    const response: { flags: CurrentFlag[]; generated_at: string; bet_game_ids?: string[] } = {
      flags: [flag],
      generated_at: '2026-10-10T00:00:00.000Z',
    };
    expect(readBetGameIds(response)).toEqual([]);
    expect(betChipLabel(flag.bets?.map((bet) => bet.label) ?? [])).toBeNull();
    expect(rankHomeFlags(response.flags, [], new Map([[flag.game_id, flag.game]]))).toEqual([
      flag,
    ]);
  });

  it('labels the first bet and counts the rest', () => {
    expect(betChipLabel(['Over 30.5'])).toBe('BET · Over 30.5');
    expect(betChipLabel(['Over 30.5', 'CHI −3.5', 'PHI ML'])).toBe('BET · Over 30.5 +2');
  });

  it('refetches a listed game only when the score or quarter changes', () => {
    const seeded = seedOpponentRedZone(
      [],
      [{ game_id: 'game-phi', in_red_zone: false, score: { home: 20, away: 7 }, quarter: 4 }],
      ['game-phi'],
    );
    const other = noteBetGameState(seeded, {
      gameId: 'other',
      home: 0,
      away: 0,
      quarter: 1,
      nowMs: 0,
    });
    expect(other).toBe(seeded);

    const clock = noteBetGameState(seeded, {
      gameId: 'game-phi',
      home: 20,
      away: 7,
      quarter: 4,
      nowMs: 500,
    });
    expect(clock).toBe(seeded);

    const scored = noteBetGameState(seeded, {
      gameId: 'game-phi',
      home: 27,
      away: 7,
      quarter: 4,
      nowMs: 500,
    });
    expect(scored.dueAtMs).toBe(1500);

    const quarter = noteBetGameState(seeded, {
      gameId: 'game-phi',
      home: 20,
      away: 7,
      quarter: 5,
      nowMs: 800,
    });
    expect(quarter.dueAtMs).toBe(1800);

    const unseen = { ...emptyOpponentRefresh(), betGameIds: ['game-phi'] };
    const first = noteBetGameState(unseen, {
      gameId: 'game-phi',
      home: 20,
      away: 7,
      quarter: 4,
      nowMs: 0,
    });
    expect(first.dueAtMs).toBeNull();
    expect(first.seenBet['game-phi']).toEqual({ home: 20, away: 7, quarter: 4 });
  });

  it('asks for a refetch on bet_in_play and shares the in-flight hold', () => {
    expect(betEventRequestsRefetch('bet_in_play')).toBe(true);
    expect(betEventRequestsRefetch('flag_added')).toBe(false);

    const open = noteBetInPlay(emptyOpponentRefresh(), 1000);
    expect(open.dueAtMs).toBe(2000);

    const started = noteOpponentRefetchStarted(open);
    const during = noteBetInPlay(started, 2500);
    expect(during.inFlight).toBe(true);
    expect(during.pending).toBe(true);
    expect(during.dueAtMs).toBeNull();
  });
});
