import { describe, expect, it } from 'vitest';
import { applyPlayToState } from '@pivot/engine';
import { espnSummarySchema, type EspnDrive, type EspnPlay } from './espnTypes.js';
import { mapEspnPlay, resolveGameContext, type EspnGameContext } from './mapEspnPlay.js';

const context: EspnGameContext = {
  gameId: '401873308',
  week: 4,
  homeTeamId: 'IND',
  awayTeamId: 'DET',
};

/** A Q3 rush, shaped like the real entries in event 401873308. */
function play(overrides: Partial<EspnPlay> = {}): EspnPlay {
  return {
    id: '40187330839',
    type: { id: '5', text: 'Rush' },
    period: { number: 3 },
    clock: { displayValue: '13:28' },
    start: { team: { id: '11' }, yardsToEndzone: 33 },
    homeScore: 16,
    awayScore: 19,
    ...overrides,
  };
}

const detDrive: EspnDrive = { team: { id: '8', abbreviation: 'DET' } };

describe('mapEspnPlay', () => {
  it('maps a scrimmage play into a normalized PlayEvent', () => {
    expect(mapEspnPlay(play(), detDrive, context, false)).toEqual({
      playId: '40187330839',
      gameId: '401873308',
      week: 4,
      homeTeamId: 'IND',
      awayTeamId: 'DET',
      possessionTeamId: 'DET',
      playType: 'run',
      scoreHome: 16,
      scoreAway: 19,
      quarter: 3,
      secondsRemainingInQuarter: 808,
      yardsToOpponentEndzone: 33,
      isFinalPlay: false,
    });
  });

  it('takes possession from the drive even when play.start.team contradicts it', () => {
    // Real ESPN behavior: `start.team` on a play inside a DET drive can report IND's id (11).
    const mapped = mapEspnPlay(play({ start: { team: { id: '11' } } }), detDrive, context, false);

    expect(mapped.possessionTeamId).toBe('DET');
  });

  it.each([
    ['74', 'Official Timeout', 0],
    ['2', 'End Period', 58],
    ['65', 'End of Half', 0],
    ['66', 'End of Game', 0],
  ])('reports no possession and no yardage on %s (%s)', (typeId, _label, yardsToEndzone) => {
    // ESPN still sends a start.team and a yardsToEndzone here; both are junk on procedural entries.
    const mapped = mapEspnPlay(
      play({ type: { id: typeId }, start: { team: { id: '11' }, yardsToEndzone } }),
      detDrive,
      context,
      false,
    );

    expect(mapped.possessionTeamId).toBeNull();
    expect(mapped.yardsToOpponentEndzone).toBeNull();
  });

  it('keeps possession on a kickoff, which ESPN files under the receiving team’s drive', () => {
    const mapped = mapEspnPlay(play({ type: { id: '53' } }), detDrive, context, false);

    expect(mapped.playType).toBe('kickoff');
    expect(mapped.possessionTeamId).toBe('DET');
  });

  it('reports no possession when the drive has no team', () => {
    expect(mapEspnPlay(play(), {}, context, false).possessionTeamId).toBeNull();
  });

  it('rewrites ESPN’s WSH to the WAS abbreviation the rest of the system uses', () => {
    const mapped = mapEspnPlay(play(), { team: { abbreviation: 'WSH' } }, context, false);

    expect(mapped.possessionTeamId).toBe('WAS');
  });

  it.each([
    ['15:00', 900],
    ['13:28', 808],
    ['0:49', 49],
    ['0:00', 0],
  ])('parses the %s game clock as %i seconds', (displayValue, expected) => {
    const mapped = mapEspnPlay(play({ clock: { displayValue } }), detDrive, context, false);

    expect(mapped.secondsRemainingInQuarter).toBe(expected);
  });

  it.each(['', 'halftime', '1:2:3', '12:345'])(
    'falls back to 0 seconds on the unparseable clock "%s"',
    (displayValue) => {
      const mapped = mapEspnPlay(play({ clock: { displayValue } }), detDrive, context, false);

      expect(mapped.secondsRemainingInQuarter).toBe(0);
    },
  );

  it('falls back on absent optional fields rather than dropping the play', () => {
    const mapped = mapEspnPlay(
      { id: 'p1', type: { id: '5' } },
      { team: { abbreviation: 'DET' } },
      context,
      false,
    );

    expect(mapped).toMatchObject({
      playId: 'p1',
      playType: 'run',
      quarter: 0,
      secondsRemainingInQuarter: 0,
      scoreHome: 0,
      scoreAway: 0,
      yardsToOpponentEndzone: null,
    });
  });

  it('cannot fabricate a unit on the field from an unrecognized play type', () => {
    const mapped = mapEspnPlay(play({ type: { id: '4242' } }), detDrive, context, false);

    expect(mapped.playType).toBe('no_play');
    expect(applyPlayToState(null, mapped).unitOnField).toBe('none');
  });

  it('passes isFinalPlay through from the caller', () => {
    expect(mapEspnPlay(play(), detDrive, context, true).isFinalPlay).toBe(true);
  });
});

/**
 * A verbatim slice of the real response for event 401873308 (Colts @ Lions, 2026-08-29), including
 * keys the schema does not declare — so this asserts both that the declared shape matches production
 * and that ESPN adding fields is a no-op rather than a validation failure.
 */
const REAL_SUMMARY_SLICE = {
  header: {
    id: '401873308',
    week: 4,
    season: { year: 2026, type: 1 },
    competitions: [
      {
        competitors: [
          {
            id: '11',
            homeAway: 'home',
            team: { abbreviation: 'IND', displayName: 'Indianapolis Colts' },
          },
          {
            id: '8',
            homeAway: 'away',
            team: { abbreviation: 'DET', displayName: 'Detroit Lions' },
          },
        ],
        status: { type: { state: 'post', completed: true, description: 'Final' } },
      },
    ],
  },
  drives: {
    previous: [
      {
        id: '4018733081',
        team: { id: '11', name: 'Colts', abbreviation: 'IND' },
        plays: [
          {
            id: '40187330839',
            sequenceNumber: '3900',
            type: { id: '53', text: 'Kickoff', abbreviation: 'K' },
            text: 'J.Bates kicks 62 yards from DET 35 to IND 3.',
            awayScore: 0,
            homeScore: 0,
            period: { number: 1 },
            clock: { displayValue: '15:00' },
            scoringPlay: false,
            wallclock: '2026-08-29T17:08:19Z',
            start: { down: 1, distance: 10, yardsToEndzone: 97, team: { id: '11' } },
          },
        ],
      },
    ],
  },
};

describe('espnSummarySchema + resolveGameContext', () => {
  it('accepts a real response slice and keeps the fields the mapper reads', () => {
    const parsed = espnSummarySchema.safeParse(REAL_SUMMARY_SLICE);
    expect(parsed.success).toBe(true);

    const firstPlay = parsed.data?.drives?.previous?.[0]?.plays?.[0];
    expect(firstPlay).toMatchObject({
      id: '40187330839',
      type: { id: '53', text: 'Kickoff' },
      clock: { displayValue: '15:00' },
    });
    // Undeclared keys are stripped, not rejected.
    expect(firstPlay).not.toHaveProperty('wallclock');
  });

  it('resolves game context from the header', () => {
    const summary = espnSummarySchema.parse(REAL_SUMMARY_SLICE);

    expect(resolveGameContext(summary, '401873308')).toEqual({
      gameId: '401873308',
      week: 4,
      homeTeamId: 'IND',
      awayTeamId: 'DET',
    });
  });

  it('applies the WSH → WAS override to the home and away ids', () => {
    const summary = espnSummarySchema.parse({
      header: {
        week: 1,
        competitions: [
          {
            competitors: [
              { id: '28', homeAway: 'home', team: { abbreviation: 'WSH' } },
              { id: '19', homeAway: 'away', team: { abbreviation: 'NYG' } },
            ],
          },
        ],
      },
    });

    expect(resolveGameContext(summary, 'g1')).toMatchObject({
      homeTeamId: 'WAS',
      awayTeamId: 'NYG',
    });
  });

  it('defaults week to 0 when the header omits it', () => {
    const summary = espnSummarySchema.parse({
      header: {
        competitions: [
          {
            competitors: [
              { id: '11', homeAway: 'home', team: { abbreviation: 'IND' } },
              { id: '8', homeAway: 'away', team: { abbreviation: 'DET' } },
            ],
          },
        ],
      },
    });

    expect(resolveGameContext(summary, 'g1')?.week).toBe(0);
  });

  it.each([
    ['no header at all', {}],
    ['a competition with no competitors', { header: { competitions: [{}] } }],
    [
      'only one side identified',
      {
        header: {
          competitions: [
            { competitors: [{ id: '11', homeAway: 'home', team: { abbreviation: 'IND' } }] },
          ],
        },
      },
    ],
    [
      'a competitor missing its abbreviation',
      {
        header: {
          competitions: [
            {
              competitors: [
                { id: '11', homeAway: 'home', team: {} },
                { id: '8', homeAway: 'away', team: { abbreviation: 'DET' } },
              ],
            },
          ],
        },
      },
    ],
  ])('returns null for %s, leaving the caller to report it', (_label, raw) => {
    const summary = espnSummarySchema.parse(raw);

    expect(resolveGameContext(summary, 'g1')).toBeNull();
  });
});
