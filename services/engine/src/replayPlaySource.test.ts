import { describe, expect, it } from 'vitest';
import { mapNflverseRow, type NflverseRow } from './replayPlaySource.js';

function row(overrides: Partial<NflverseRow> = {}): NflverseRow {
  return {
    play_id: '40',
    game_id: '2024_08_KC_LV',
    home_team: 'LV',
    away_team: 'KC',
    week: '8',
    posteam: 'KC',
    defteam: 'LV',
    yardline_100: '65',
    down: '1',
    ydstogo: '10',
    quarter_seconds_remaining: '870',
    qtr: '1',
    play_type: 'run',
    two_point_attempt: '0',
    timeout: '0',
    quarter_end: '0',
    total_home_score: '0',
    total_away_score: '3',
    // Post-play scores (KC = posteam = 3, LV = defteam = 0). Home is LV, so home=0 / away=3.
    posteam_score_post: '3',
    defteam_score_post: '0',
    ...overrides,
  };
}

describe('mapNflverseRow', () => {
  it('maps a normal offensive run play', () => {
    expect(mapNflverseRow(row(), false)).toEqual({
      playId: '40',
      gameId: '2024_08_KC_LV',
      week: 8,
      homeTeamId: 'LV',
      awayTeamId: 'KC',
      possessionTeamId: 'KC',
      playType: 'run',
      scoreHome: 0,
      scoreAway: 3,
      quarter: 1,
      secondsRemainingInQuarter: 870,
      yardsToOpponentEndzone: 65,
      down: 1,
      distance: 10,
      isFinalPlay: false,
    });
  });

  it('uses post-play scores (not pre-play totals) when the away team is on offense', () => {
    // KC (away) scores: pre-play away total is stale at 3, post-play is 9. Home is LV (defending, 0).
    const play = mapNflverseRow(
      row({
        posteam: 'KC',
        home_team: 'LV',
        total_away_score: '3',
        posteam_score_post: '9',
        defteam_score_post: '0',
      }),
      false,
    );
    expect(play.scoreAway).toBe(9);
    expect(play.scoreHome).toBe(0);
  });

  it('translates post-play scores to home/away when the home team is on offense', () => {
    const play = mapNflverseRow(
      row({ posteam: 'LV', home_team: 'LV', posteam_score_post: '10', defteam_score_post: '7' }),
      false,
    );
    expect(play.scoreHome).toBe(10);
    expect(play.scoreAway).toBe(7);
  });

  it('falls back to pre-play running totals when post-play scores are absent (e.g. kickoff)', () => {
    const play = mapNflverseRow(
      row({
        posteam: '',
        posteam_score_post: '',
        defteam_score_post: '',
        total_home_score: '14',
        total_away_score: '10',
      }),
      false,
    );
    expect(play.scoreHome).toBe(14);
    expect(play.scoreAway).toBe(10);
  });

  it('treats an empty posteam / yardline (e.g. kickoff) as null', () => {
    const play = mapNflverseRow(
      row({ posteam: '', yardline_100: '', down: '1', ydstogo: '10', play_type: 'kickoff' }),
      false,
    );
    expect(play.possessionTeamId).toBeNull();
    expect(play.yardsToOpponentEndzone).toBeNull();
    expect(play.down).toBeNull();
    expect(play.distance).toBeNull();
    expect(play.playType).toBe('kickoff');
  });

  it('maps down and ydstogo on a scrimmage play', () => {
    const play = mapNflverseRow(row({ down: '3', ydstogo: '7' }), false);
    expect(play.down).toBe(3);
    expect(play.distance).toBe(7);
  });

  it('maps a two-point attempt to two_point_attempt regardless of underlying pass/run', () => {
    expect(mapNflverseRow(row({ play_type: 'pass', two_point_attempt: '1' }), false).playType).toBe(
      'two_point_attempt',
    );
  });

  it('maps special-teams play types', () => {
    expect(mapNflverseRow(row({ play_type: 'field_goal' }), false).playType).toBe('field_goal');
    expect(mapNflverseRow(row({ play_type: 'punt' }), false).playType).toBe('punt');
    expect(mapNflverseRow(row({ play_type: 'extra_point' }), false).playType).toBe('extra_point');
  });

  it('maps a timeout row (no play_type, timeout=1) to timeout', () => {
    expect(mapNflverseRow(row({ play_type: '', timeout: '1' }), false).playType).toBe('timeout');
  });

  it('maps a quarter-end row to end_period', () => {
    expect(mapNflverseRow(row({ play_type: '', quarter_end: '1' }), false).playType).toBe(
      'end_period',
    );
  });

  it('maps an unrecognized/empty play type to no_play', () => {
    expect(mapNflverseRow(row({ play_type: '' }), false).playType).toBe('no_play');
    expect(mapNflverseRow(row({ play_type: 'NA' }), false).playType).toBe('no_play');
  });

  it('honors the isFinalPlay flag from the caller', () => {
    expect(mapNflverseRow(row(), true).isFinalPlay).toBe(true);
  });

  it('reads OT as quarter 5', () => {
    expect(mapNflverseRow(row({ qtr: '5' }), false).quarter).toBe(5);
  });
});
