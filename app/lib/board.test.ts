import { describe, expect, it } from 'vitest';
import {
  buildBoardRows,
  flattenRows,
  groupWindow,
  isPregameBranch,
  networkLabel,
  nextKickoff,
  pickFeaturedGame,
  type StakeRef,
} from './board';
import type { GameBroadcast } from './gameDisplay';
import { resolveHomeBranch, type HomeBranch } from './homeState';
import type { ScheduleGame } from './schedule';
import { STREAMING_SERVICES } from './streamingServices';

function broadcast(service: string): GameBroadcast {
  return {
    service,
    deep_link_url: `https://example.test/${service}`,
    requires_subscription: false,
    user_has_subscription: false,
    typical_lag_seconds: 0,
    preferred: false,
  };
}

function game(
  gameId: string,
  scheduledStart: string,
  overrides: Partial<ScheduleGame> = {},
): ScheduleGame {
  return {
    game_id: gameId,
    status: 'scheduled',
    scheduled_start: scheduledStart,
    home_team: 'KC',
    away_team: 'BUF',
    home_team_name: 'Chiefs',
    away_team_name: 'Bills',
    home_team_primary_color: '#E31837',
    home_team_secondary_color: '#FFB81C',
    away_team_primary_color: '#00338D',
    away_team_secondary_color: '#C60C30',
    broadcasts: [],
    ...overrides,
  };
}

/** Carriers retransmit a feed; they can never be the airing network. */
const CARRIERS = ['sunday_ticket', 'hulu', 'fubo', 'directv'];

describe('networkLabel', () => {
  it('returns null when there are no broadcasts', () => {
    expect(networkLabel([])).toBeNull();
  });

  it('returns null when only carriers are listed', () => {
    expect(networkLabel(CARRIERS.map(broadcast))).toBeNull();
  });

  it('prefers a linear network over the carriers alongside it', () => {
    // The shape `seed-broadcasts.ts` actually produces: one OTA plus two paid options.
    expect(networkLabel([broadcast('sunday_ticket'), broadcast('cbs'), broadcast('nfl_plus')])).toBe(
      'CBS',
    );
  });

  it('prefers a linear network over a streaming exclusive', () => {
    expect(networkLabel([broadcast('amazon_prime'), broadcast('fox')])).toBe('FOX');
  });

  it('ranks deterministically when two networks are listed', () => {
    expect(networkLabel([broadcast('nbc'), broadcast('cbs')])).toBe('CBS');
    expect(networkLabel([broadcast('cbs'), broadcast('nbc')])).toBe('CBS');
  });

  it('shortens the streaming exclusives that serviceLabel spells out', () => {
    expect(networkLabel([broadcast('amazon_prime')])).toBe('PRIME');
    expect(networkLabel([broadcast('nfl_network')])).toBe('NFLN');
    expect(networkLabel([broadcast('peacock')])).toBe('PEACOCK');
    expect(networkLabel([broadcast('paramount_plus')])).toBe('PARAMOUNT+');
  });

  it('reuses serviceLabel where it is already the short form', () => {
    expect(networkLabel([broadcast('espn_plus')])).toBe('ESPN+');
    expect(networkLabel([broadcast('nfl_plus')])).toBe('NFL+');
    expect(networkLabel([broadcast('abc')])).toBe('ABC');
  });

  it('ignores a service outside the catalog instead of echoing it', () => {
    expect(networkLabel([broadcast('some_new_service')])).toBeNull();
    expect(networkLabel([broadcast('some_new_service'), broadcast('nbc')])).toBe('NBC');
  });

  it('classifies every catalog service as either a network or a carrier', () => {
    for (const service of STREAMING_SERVICES) {
      const label = networkLabel([broadcast(service)]);
      if (CARRIERS.includes(service)) {
        expect(label, service).toBeNull();
      } else {
        expect(label, service).toBeTruthy();
        // Never leak the raw enum key into the UI.
        expect(label, service).not.toBe(service);
      }
    }
  });
});

describe('groupWindow', () => {
  it('splits Sunday into its four broadcast windows', () => {
    expect(groupWindow(new Date('2026-09-20T13:30:00Z'))).toBe('SUNDAY · MORNING'); // 9:30am ET
    expect(groupWindow(new Date('2026-09-20T17:00:00Z'))).toBe('SUNDAY · EARLY'); // 1:00pm ET
    expect(groupWindow(new Date('2026-09-20T20:25:00Z'))).toBe('SUNDAY · LATE'); // 4:25pm ET
    expect(groupWindow(new Date('2026-09-21T00:20:00Z'))).toBe('PRIMETIME'); // 8:20pm ET
  });

  it('puts the Sunday boundaries on the expected side', () => {
    expect(groupWindow(new Date('2026-09-20T16:00:00Z'))).toBe('SUNDAY · EARLY'); // 12:00pm ET
    expect(groupWindow(new Date('2026-09-20T20:00:00Z'))).toBe('SUNDAY · LATE'); // 4:00pm ET
    expect(groupWindow(new Date('2026-09-20T22:59:00Z'))).toBe('SUNDAY · LATE'); // 6:59pm ET
    expect(groupWindow(new Date('2026-09-20T23:00:00Z'))).toBe('PRIMETIME'); // 7:00pm ET
  });

  it('separates Thursday night from a Thanksgiving afternoon kickoff', () => {
    expect(groupWindow(new Date('2026-09-18T00:15:00Z'))).toBe('THURSDAY NIGHT'); // Thu 8:15pm ET
    expect(groupWindow(new Date('2026-11-26T17:30:00Z'))).toBe('THURSDAY'); // Thanksgiving 12:30pm
    expect(groupWindow(new Date('2026-11-27T01:20:00Z'))).toBe('THURSDAY NIGHT'); // Thanksgiving night
  });

  it('labels the other game days', () => {
    expect(groupWindow(new Date('2026-11-27T20:00:00Z'))).toBe('FRIDAY'); // Black Friday 3pm ET
    expect(groupWindow(new Date('2026-12-19T18:00:00Z'))).toBe('SATURDAY'); // 1pm ET
    expect(groupWindow(new Date('2026-09-22T00:15:00Z'))).toBe('MONDAY'); // Mon 8:15pm ET
  });

  it('never returns a blank label for a real week of kickoffs', () => {
    // Regression guard. The first cut read the weekday via `formatToParts`, which Hermes tags
    // `type: 'literal'` rather than `type: 'weekday'`. Every lookup missed, every kickoff got the
    // label '', and the whole slate collapsed into one unlabelled group on device while these
    // tests stayed green under Node.
    const week = [
      '2026-09-18T00:15:00Z', // Thu night
      '2026-09-20T13:30:00Z', // Sun morning (international)
      '2026-09-20T17:00:00Z', // Sun early
      '2026-09-20T20:25:00Z', // Sun late
      '2026-09-21T00:20:00Z', // Sun primetime
      '2026-09-22T00:15:00Z', // Mon night
    ];
    const labels = week.map((iso) => groupWindow(new Date(iso)));
    expect(labels.every((label) => label.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(week.length);
  });

  it('groups by Eastern time across the DST transition', () => {
    // Both are 1:00pm ET Sunday kickoffs, but the UTC offset differs (EDT vs. EST) because DST
    // ends Nov 1. A naive UTC-hour split would file these in different windows.
    expect(groupWindow(new Date('2026-10-25T17:00:00Z'))).toBe('SUNDAY · EARLY');
    expect(groupWindow(new Date('2026-11-01T18:00:00Z'))).toBe('SUNDAY · EARLY');
  });
});

describe('buildBoardRows', () => {
  const slate: ScheduleGame[] = [
    game('g1', '2026-09-18T00:15:00Z', {
      away_team: 'BUF',
      home_team: 'MIA',
      broadcasts: [broadcast('amazon_prime'), broadcast('sunday_ticket')],
    }),
    game('g2', '2026-09-20T17:00:00Z', { away_team: 'NYJ', home_team: 'NE' }),
    game('g10', '2026-09-20T17:00:00Z', { away_team: 'DAL', home_team: 'PHI' }),
    game('g3', '2026-09-20T20:25:00Z', { away_team: 'SF', home_team: 'SEA' }),
    game('g4', '2026-09-22T00:15:00Z', { away_team: 'KC', home_team: 'DEN' }),
  ];

  it('groups the whole slate by window, ordered by first kickoff', () => {
    const groups = buildBoardRows(slate, []);
    expect(groups.map((group) => group.label)).toEqual([
      'THURSDAY NIGHT',
      'SUNDAY · EARLY',
      'SUNDAY · LATE',
      'MONDAY',
    ]);
    expect(flattenRows(groups)).toHaveLength(5);
  });

  it('includes games the user has no stake in', () => {
    const groups = buildBoardRows(slate, [{ gameId: 'g1', teamId: 'MIA' }]);
    const staked = flattenRows(groups).filter((row) => row.stakeCount > 0);
    expect(staked.map((row) => row.gameId)).toEqual(['g1']);
    expect(flattenRows(groups)).toHaveLength(5);
  });

  it('orders same-kickoff games by id, numeric-aware', () => {
    const early = buildBoardRows(slate, []).find((group) => group.label === 'SUNDAY · EARLY');
    expect(early?.rows.map((row) => row.gameId)).toEqual(['g2', 'g10']);
  });

  it('counts stakes per game and stripes the side carrying more of them', () => {
    const refs: StakeRef[] = [
      { gameId: 'g2', teamId: 'NYJ' },
      { gameId: 'g2', teamId: 'NYJ' },
      { gameId: 'g2', teamId: 'NE' },
      { gameId: 'g3', teamId: 'SEA' },
    ];
    const rows = flattenRows(buildBoardRows(slate, refs));
    const g2 = rows.find((row) => row.gameId === 'g2');
    const g3 = rows.find((row) => row.gameId === 'g3');

    expect(g2?.stakeCount).toBe(3);
    expect(g2?.stripeSide).toBe('away');
    expect(g3?.stakeCount).toBe(1);
    expect(g3?.stripeSide).toBe('home');
  });

  it('breaks an even stake split toward home', () => {
    const rows = flattenRows(
      buildBoardRows(slate, [
        { gameId: 'g2', teamId: 'NYJ' },
        { gameId: 'g2', teamId: 'NE' },
      ]),
    );
    expect(rows.find((row) => row.gameId === 'g2')?.stripeSide).toBe('home');
  });

  it('leaves stripeSide null with no stake', () => {
    const rows = flattenRows(buildBoardRows(slate, []));
    expect(rows.every((row) => row.stripeSide === null)).toBe(true);
  });

  it('keeps stake dots on games already played', () => {
    const finished = [game('gf', '2026-09-18T00:15:00Z', { status: 'final', home_team: 'MIA' })];
    const rows = flattenRows(buildBoardRows(finished, [{ gameId: 'gf', teamId: 'MIA' }]));
    expect(rows[0]?.status).toBe('final');
    expect(rows[0]?.stakeCount).toBe(1);
    expect(rows[0]?.stripeSide).toBe('home');
  });

  it('carries team colors and the airing network through to the row', () => {
    const rows = flattenRows(buildBoardRows(slate, []));
    const g1 = rows.find((row) => row.gameId === 'g1');
    expect(g1?.network).toBe('PRIME');
    expect(g1?.awayTeamColor).toBe('#00338D');
    expect(g1?.homeTeamColor).toBe('#E31837');
    expect(rows.find((row) => row.gameId === 'g2')?.network).toBeNull();
  });

  it('skips a game with an unparseable kickoff rather than grouping it as Invalid Date', () => {
    const groups = buildBoardRows([...slate, game('gx', 'not-a-date')], []);
    expect(flattenRows(groups).map((row) => row.gameId)).not.toContain('gx');
    expect(flattenRows(groups)).toHaveLength(5);
  });

  it('returns no groups for an empty slate', () => {
    expect(buildBoardRows([], [])).toEqual([]);
  });
});

describe('pickFeaturedGame', () => {
  const slate: ScheduleGame[] = [
    game('g1', '2026-09-20T17:00:00Z'),
    game('g2', '2026-09-20T17:00:00Z'),
    game('g3', '2026-09-20T20:25:00Z'),
    game('g4', '2026-09-22T00:15:00Z'),
  ];
  const before = new Date('2026-09-20T12:00:00Z');

  function rowsFor(refs: StakeRef[]) {
    return flattenRows(buildBoardRows(slate, refs));
  }

  it('returns null when nothing is staked', () => {
    expect(pickFeaturedGame(rowsFor([]), before)).toBeNull();
  });

  it('picks the game with the most stakes', () => {
    const featured = pickFeaturedGame(
      rowsFor([
        { gameId: 'g1', teamId: 'KC' },
        { gameId: 'g3', teamId: 'KC' },
        { gameId: 'g3', teamId: 'BUF' },
      ]),
      before,
    );
    expect(featured?.gameId).toBe('g3');
  });

  it('breaks a stake tie toward the earlier kickoff', () => {
    const featured = pickFeaturedGame(
      rowsFor([
        { gameId: 'g3', teamId: 'KC' },
        { gameId: 'g1', teamId: 'KC' },
      ]),
      before,
    );
    expect(featured?.gameId).toBe('g1');
  });

  it('breaks a stake-and-kickoff tie by id, deterministically', () => {
    const refs: StakeRef[] = [
      { gameId: 'g2', teamId: 'KC' },
      { gameId: 'g1', teamId: 'KC' },
    ];
    expect(pickFeaturedGame(rowsFor(refs), before)?.gameId).toBe('g1');
    expect(pickFeaturedGame(rowsFor(refs.slice().reverse()), before)?.gameId).toBe('g1');
  });

  it('ignores staked games that have already kicked off', () => {
    const refs: StakeRef[] = [
      { gameId: 'g1', teamId: 'KC' },
      { gameId: 'g1', teamId: 'BUF' },
      { gameId: 'g4', teamId: 'KC' },
    ];
    // Past g1's kickoff: the two-stake game is gone, so the single-stake Monday game wins.
    const featured = pickFeaturedGame(rowsFor(refs), new Date('2026-09-20T18:00:00Z'));
    expect(featured?.gameId).toBe('g4');
  });

  it('returns null once every staked game has kicked off', () => {
    const refs: StakeRef[] = [{ gameId: 'g1', teamId: 'KC' }];
    expect(pickFeaturedGame(rowsFor(refs), new Date('2026-09-23T00:00:00Z'))).toBeNull();
  });
});

describe('isPregameBranch', () => {
  it('covers exactly the two branches that share the pre-game view', () => {
    const everyBranch: HomeBranch['branch'][] = [
      'no_leagues',
      'season_idle',
      'state1',
      'state2',
      'state3',
      'state4',
    ];
    expect(everyBranch.filter(isPregameBranch)).toEqual(['state3', 'state4']);
  });

  it('is false before a branch has resolved', () => {
    expect(isPregameBranch(null)).toBe(false);
  });

  it('routes both real pre-game branches to the same view', () => {
    // Same inputs apart from the kickoff: one inside the pre-game window, one with nothing
    // scheduled. `resolveHomeBranch` still distinguishes them; the presentation does not.
    const base = {
      hasLeagues: true,
      displayPhase: 'regular' as const,
      hasFlags: false,
      hasLiveStakeGames: false,
      now: new Date('2026-09-20T12:00:00Z'),
    };
    const inWindow = resolveHomeBranch({
      ...base,
      nextStakeKickoff: new Date('2026-09-20T17:00:00Z'),
    });
    const offDay = resolveHomeBranch({ ...base, nextStakeKickoff: null });

    expect(inWindow.branch).toBe('state3');
    expect(offDay.branch).toBe('state4');
    expect(isPregameBranch(inWindow.branch)).toBe(true);
    expect(isPregameBranch(offDay.branch)).toBe(true);
  });
});

describe('nextKickoff', () => {
  const slate: ScheduleGame[] = [
    game('g1', '2026-09-20T17:00:00Z'),
    game('g2', '2026-09-20T20:25:00Z'),
    game('g3', '2026-09-22T00:15:00Z'),
  ];
  const rows = flattenRows(buildBoardRows(slate, []));

  it('finds the next game to kick off, stake or not', () => {
    expect(nextKickoff(rows, new Date('2026-09-20T12:00:00Z'))?.gameId).toBe('g1');
  });

  it('moves on once a kickoff has passed', () => {
    expect(nextKickoff(rows, new Date('2026-09-20T18:00:00Z'))?.gameId).toBe('g2');
  });

  it('treats a kickoff exactly at now as already started', () => {
    expect(nextKickoff(rows, new Date('2026-09-20T17:00:00Z'))?.gameId).toBe('g2');
  });

  it('returns null when the slate is done', () => {
    expect(nextKickoff(rows, new Date('2026-09-23T00:00:00Z'))).toBeNull();
    expect(nextKickoff([], new Date('2026-09-20T12:00:00Z'))).toBeNull();
  });
});
