import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import {
  pickProgress,
  slipSummary,
  type PropPlayer,
  type Stake,
  type ProgressContext,
} from '@pivot/engine';
import type { GameState, StakeCondition } from '@pivot/shared';
import { describe, expect, it } from 'vitest';
import { espnSummarySchema } from './espnTypes.js';
import { parseEspnPlayerStats } from './parseEspnPlayerStats.js';

/**
 * Settlement against a captured final: ATL 35 @ GB 14 (401872948). Team ids stay ESPN
 * abbreviations here; the runner translates them to `teams.id` before evaluating.
 */
const FIXTURE = fileURLToPath(
  new URL('../../fixtures/replays/401872948/2026-09-25T23:08:52.773Z.json.gz', import.meta.url),
);
const summary = espnSummarySchema.parse(
  JSON.parse(gunzipSync(readFileSync(FIXTURE)).toString('utf8')) as unknown,
);
const stats = parseEspnPlayerStats(summary, 'g', 0);

const final: GameState = {
  gameId: 'g',
  homeTeamId: 'GB',
  awayTeamId: 'ATL',
  possessionTeamId: null,
  unitOnField: 'none',
  scoreHome: 14,
  scoreAway: 35,
  quarter: 4,
  timeRemainingSec: 0,
  yardsToOpponentEndzone: null,
  down: null,
  distance: null,
  inRedZone: false,
  status: 'final',
  updatedAt: 0,
};

function person(espnId: string | null, teamId: string, first: string, last: string): PropPlayer {
  return {
    playerId: `p-${first}`,
    teamId,
    unit: 'offense',
    espnId,
    firstName: first,
    lastName: last,
  };
}

const BIJAN = person('4430807', 'ATL', 'Bijan', 'Robinson');
const LOVE = person('4036378', 'GB', 'Jordan', 'Love');
const FOLK = person('10621', 'ATL', 'Nick', 'Folk');
const WATSON = person(null, 'GB', 'Christian', 'Watson'); // no espn_id: name fallback
const SCRATCH = person('999999', 'ATL', 'Not', 'Playing');

function playerPick(who: PropPlayer, condition: StakeCondition): [Stake, ProgressContext] {
  return [
    {
      id: `${who.playerId}-${condition.type}`,
      userId: 'u',
      season: 2026,
      week: 4,
      gameId: 'g',
      subject: { type: 'PLAYER', playerId: who.playerId, teamId: who.teamId },
      condition,
      source: 'MANUAL',
      weight: 1,
      createdAt: '',
    },
    { game: final, playerStats: stats, player: who },
  ];
}

function teamPick(subject: Stake['subject'], condition: StakeCondition): [Stake, ProgressContext] {
  return [
    {
      id: `${condition.type}`,
      userId: 'u',
      season: 2026,
      week: 4,
      gameId: 'g',
      subject,
      condition,
      source: 'MANUAL',
      weight: 1,
      createdAt: '',
    },
    { game: final, playerStats: stats },
  ];
}

const status = ([stake, ctx]: [Stake, ProgressContext]) => pickProgress(stake, ctx).status;

describe('settlement from the captured ATL @ GB final', () => {
  it('settles player yardage, count, and TD props', () => {
    expect(status(playerPick(BIJAN, { type: 'STAT_OVER', stat: 'RUSH_YDS', line: 89.5 }))).toBe(
      'won',
    );
    expect(status(playerPick(BIJAN, { type: 'STAT_OVER', stat: 'ANY_TD', line: 1.5 }))).toBe('won');
    expect(status(playerPick(LOVE, { type: 'STAT_OVER', stat: 'PASS_YDS', line: 312 }))).toBe(
      'tie',
    );
    expect(status(playerPick(LOVE, { type: 'STAT_UNDER', stat: 'PASS_COMP', line: 24.5 }))).toBe(
      'lost',
    );
    expect(status(playerPick(LOVE, { type: 'STAT_OVER', stat: 'PASS_ATT', line: 52.5 }))).toBe(
      'won',
    );
    expect(status(playerPick(LOVE, { type: 'STAT_UNDER', stat: 'INT_THROWN', line: 0.5 }))).toBe(
      'lost',
    );
    expect(status(playerPick(FOLK, { type: 'STAT_OVER', stat: 'FG_MADE', line: 1.5 }))).toBe('won');
    expect(status(playerPick(FOLK, { type: 'STAT_UNDER', stat: 'KICK_PTS', line: 8.5 }))).toBe(
      'lost',
    );
  });

  it('settles anytime and first TD, matching a player without an ESPN id by name', () => {
    expect(
      status(playerPick(WATSON, { type: 'PLAYER_EVENT', event: 'FIRST_TD', side: 'YES' })),
    ).toBe('won');
    expect(
      status(playerPick(BIJAN, { type: 'PLAYER_EVENT', event: 'FIRST_TD', side: 'YES' })),
    ).toBe('lost');
    expect(status(playerPick(BIJAN, { type: 'PLAYER_EVENT', event: 'ANY_TD', side: 'YES' }))).toBe(
      'won',
    );
    expect(status(playerPick(LOVE, { type: 'PLAYER_EVENT', event: 'ANY_TD', side: 'NO' }))).toBe(
      'won',
    );
  });

  it('voids a prop on a player who is not in the final boxscore', () => {
    expect(status(playerPick(SCRATCH, { type: 'STAT_OVER', stat: 'REC_YDS', line: 40.5 }))).toBe(
      'void',
    );
  });

  it('settles team, quarter, half, first-score, and FG props', () => {
    const atl = { type: 'TEAM' as const, teamId: 'ATL' };
    const gb = { type: 'TEAM' as const, teamId: 'GB' };
    const game = { type: 'GAME' as const, gameId: 'g' };
    expect(status(teamPick(atl, { type: 'TEAM_TOTAL_OVER', line: 30.5 }))).toBe('won');
    expect(status(teamPick(atl, { type: 'TEAM_TOTAL_UNDER', line: 10, segment: 'Q2' }))).toBe(
      'tie',
    );
    expect(status(teamPick(gb, { type: 'SPREAD', line: 10.5, segment: 'H1' }))).toBe('won');
    expect(status(teamPick(game, { type: 'TOTAL_OVER', line: 24.5, segment: 'H1' }))).toBe('lost');
    expect(status(teamPick(gb, { type: 'FIRST_TO_SCORE' }))).toBe('won');
    expect(status(teamPick(game, { type: 'FG_OVER', line: 1.5 }))).toBe('won');
    expect(status(teamPick(gb, { type: 'FG_OVER', line: 0.5 }))).toBe('lost');
  });

  it('settles a parlay of those legs: one lost leg loses it, refunded legs drop out', () => {
    const won = [
      playerPick(BIJAN, { type: 'STAT_OVER', stat: 'RUSH_YDS', line: 89.5 }),
      playerPick(LOVE, { type: 'STAT_OVER', stat: 'PASS_YDS', line: 312 }), // tie
      playerPick(SCRATCH, { type: 'STAT_OVER', stat: 'REC_YDS', line: 40.5 }), // void
    ].map(([s, c]) => pickProgress(s, c));
    expect(slipSummary(won)).toMatchObject({ status: 'won', hit: 1, refunded: 2 });

    const lost = [
      ...won,
      pickProgress(...playerPick(BIJAN, { type: 'PLAYER_EVENT', event: 'FIRST_TD', side: 'YES' })),
    ];
    expect(slipSummary(lost)).toMatchObject({ status: 'lost', lost: 1 });
  });
});
