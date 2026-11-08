import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { espnSummarySchema, type EspnSummary } from './espnTypes.js';
import { parseEspnPlayerStats } from './parseEspnPlayerStats.js';

/** ATL 35 @ GB 14, final (Sept 25, 2026 TNF). */
const FIXTURE = fileURLToPath(
  new URL('../../fixtures/replays/401872948/2026-09-25T23:08:52.773Z.json.gz', import.meta.url),
);

function loadFixture(): EspnSummary {
  const raw: unknown = JSON.parse(gunzipSync(readFileSync(FIXTURE)).toString('utf8'));
  return espnSummarySchema.parse(raw);
}

const BIJAN = '4430807';
const PENIX = '4360423';
const LOVE = '4036378';
const FOLK = '10621';
const WATSON = '4248528';
const XAVIER_WATTS = '4431005';

describe('parseEspnPlayerStats (committed final summary)', () => {
  const stats = parseEspnPlayerStats(loadFixture(), 'game-1', 1000);

  it('reads the game as final and keeps the ids it was given', () => {
    expect(stats.final).toBe(true);
    expect(stats.gameId).toBe('game-1');
    expect(stats.fetchedAt).toBe(1000);
  });

  it('reads rushing and receiving lines, with rushing and receiving TDs in ANY_TD', () => {
    expect(stats.players[BIJAN]).toEqual({
      teamId: 'ATL',
      displayName: 'Bijan Robinson',
      stats: { RUSH_YDS: 194, RUSH_ATT: 29, REC_YDS: 19, RECEPTIONS: 2, ANY_TD: 2 },
    });
    expect(stats.players[WATSON]?.stats).toMatchObject({ REC_YDS: 96, RECEPTIONS: 7, ANY_TD: 1 });
  });

  it('splits completions/attempts and does not credit the passer with passing TDs as scored', () => {
    expect(stats.players[LOVE]?.stats).toMatchObject({
      PASS_YDS: 312,
      PASS_COMP: 28,
      PASS_ATT: 53,
      PASS_TD: 2,
      INT_THROWN: 1,
      RUSH_YDS: 0,
      ANY_TD: 0,
    });
    expect(stats.players[PENIX]?.stats).toMatchObject({
      PASS_COMP: 18,
      PASS_ATT: 25,
      RUSH_YDS: -2,
    });
  });

  it('reads interceptions thrown from the passing group, not the defender', () => {
    expect(stats.players[XAVIER_WATTS]?.stats.INT_THROWN).toBeUndefined();
    expect(stats.players[XAVIER_WATTS]?.stats.ANY_TD).toBe(0);
  });

  it('reads kicking FGs made and kicking points', () => {
    expect(stats.players[FOLK]?.stats).toMatchObject({ FG_MADE: 2, KICK_PTS: 9, ANY_TD: 0 });
  });

  it('reads per-quarter linescores', () => {
    expect(stats.linescores).toEqual({ home: [7, 0, 0, 7], away: [7, 10, 7, 11] });
  });

  it('lists scoring plays in order with team, period, and kind', () => {
    expect(stats.scoringPlays).toHaveLength(8);
    expect(stats.scoringPlays[0]).toEqual({
      teamId: 'GB',
      period: 1,
      kind: 'TD',
      text: 'Christian Watson 4 Yd pass from Jordan Love (Trey Smack Kick)',
    });
    expect(stats.scoringPlays.filter((play) => play.kind === 'FG')).toHaveLength(2);
  });
});

describe('parseEspnPlayerStats (edge shapes)', () => {
  it('returns empty stats for a summary with no boxscore or scoring plays', () => {
    const stats = parseEspnPlayerStats({}, 'g', 0);
    expect(stats).toEqual({
      gameId: 'g',
      fetchedAt: 0,
      final: false,
      players: {},
      linescores: { home: [], away: [] },
      scoringPlays: [],
    });
  });

  it('maps WSH to WAS and takes the larger of the two defensive TD cells', () => {
    const summary = espnSummarySchema.parse({
      boxscore: {
        players: [
          {
            team: { abbreviation: 'WSH' },
            statistics: [
              {
                name: 'defensive',
                keys: ['totalTackles', 'defensiveTouchdowns'],
                athletes: [{ athlete: { id: '9', displayName: 'A B' }, stats: ['3', '1'] }],
              },
              {
                name: 'interceptions',
                keys: ['interceptions', 'interceptionTouchdowns'],
                athletes: [{ athlete: { id: '9', displayName: 'A B' }, stats: ['1', '1'] }],
              },
            ],
          },
        ],
      },
    });
    const stats = parseEspnPlayerStats(summary, 'g', 0);
    expect(stats.players['9']).toEqual({ teamId: 'WAS', displayName: 'A B', stats: { ANY_TD: 1 } });
  });

  it('skips a non-numeric cell instead of writing NaN', () => {
    const summary = espnSummarySchema.parse({
      boxscore: {
        players: [
          {
            team: { abbreviation: 'GB' },
            statistics: [
              {
                name: 'rushing',
                keys: ['rushingAttempts', 'rushingYards', 'rushingTouchdowns'],
                athletes: [{ athlete: { id: '1' }, stats: ['--', '12', '0'] }],
              },
            ],
          },
        ],
      },
    });
    expect(parseEspnPlayerStats(summary, 'g', 0).players['1']?.stats).toEqual({
      RUSH_YDS: 12,
      ANY_TD: 0,
    });
  });

  it('drops a malformed boxscore without failing the summary parse', () => {
    const parsed = espnSummarySchema.safeParse({ boxscore: { players: 'nope' }, scoringPlays: 3 });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.boxscore).toBeUndefined();
      expect(parsed.data.scoringPlays).toBeUndefined();
    }
  });
});
