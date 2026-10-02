import { describe, expect, it } from 'vitest';
import {
  alsoFlaggedSituationLines,
  compactScoreLabel,
  formatClock,
  liveClockLabel,
  pickPreferredBroadcast,
  quarterLabel,
  reasonLabel,
  serviceLabel,
  downDistanceLabel,
  fieldPositionLabel,
  fieldGaugeMarkerPercent,
  fieldGaugeShowsRedZone,
  FIELD_GAUGE_MINOR_TICK_PERCENTS,
  FIELD_GAUGE_RED_ZONE_PERCENT,
  FIELD_GAUGE_TICK_LABELS,
  fieldGaugeTickPercent,
  gameClockLine,
  matchupNicknameLabel,
  fieldAlignedMatchup,
  hexWithAlpha,
  opponentAbbreviation,
  localRouteOption,
  watchCta,
  watchOptionLabel,
  watchOptionParts,
  type GameBroadcast,
} from './gameDisplay';
import type { GameSummary } from './flagEventPayload';

describe('serviceLabel', () => {
  it('maps known services to display names', () => {
    expect(serviceLabel('youtube_tv')).toBe('YouTube TV');
    expect(serviceLabel('sunday_ticket')).toBe('NFL Sunday Ticket');
    expect(serviceLabel('espn_plus')).toBe('ESPN+');
    expect(serviceLabel('espn')).toBe('ESPN');
    expect(serviceLabel('fox')).toBe('FOX');
    expect(serviceLabel('hulu_live')).toBe('Hulu + Live TV');
    expect(serviceLabel('fubo')).toBe('Fubo');
    expect(serviceLabel('directv')).toBe('DIRECTV');
    expect(serviceLabel('sling')).toBe('Sling TV');
  });

  it('falls back to the raw value for an unknown service', () => {
    expect(serviceLabel('some_future_service')).toBe('some_future_service');
  });
});

describe('reasonLabel', () => {
  it('maps known reasons and falls back to the raw type', () => {
    expect(reasonLabel('offense_active')).toBe('Your offense is on the field');
    expect(reasonLabel('red_zone')).toBe('In the red zone');
    expect(reasonLabel('mystery')).toBe('mystery');
  });
});

describe('formatClock', () => {
  it('formats seconds as M:SS', () => {
    expect(formatClock(434)).toBe('7:14');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(605)).toBe('10:05');
    expect(formatClock(9)).toBe('0:09');
  });

  it('clamps negative input to 0:00', () => {
    expect(formatClock(-5)).toBe('0:00');
  });
});

describe('quarterLabel', () => {
  it('labels regulation quarters and OT', () => {
    expect(quarterLabel(1)).toBe('Q1');
    expect(quarterLabel(4)).toBe('Q4');
    expect(quarterLabel(5)).toBe('OT');
  });
});

describe('liveClockLabel', () => {
  it('shows the quarter and clock in regulation', () => {
    expect(liveClockLabel(1, 900)).toBe('Q1 15:00');
    expect(liveClockLabel(3, 156)).toBe('Q3 2:36');
    expect(liveClockLabel(4, 0)).toBe('Q4 0:00');
  });

  it('reads the end of Q2 as HALF', () => {
    expect(liveClockLabel(2, 0)).toBe('HALF');
    expect(liveClockLabel(2, 1)).toBe('Q2 0:01');
  });

  it('labels overtime as OT', () => {
    expect(liveClockLabel(5, 432)).toBe('OT 7:12');
  });

  it('falls back to the quarter alone when the clock is missing', () => {
    expect(liveClockLabel(3, null)).toBe('Q3');
    expect(liveClockLabel(5, Number.NaN)).toBe('OT');
  });

  it('falls back to LIVE before a quarter is known', () => {
    expect(liveClockLabel(0, 900)).toBe('LIVE');
    expect(liveClockLabel(Number.NaN, null)).toBe('LIVE');
  });
});

describe('compactScoreLabel', () => {
  it('puts the away score first, matching the matchup order', () => {
    expect(compactScoreLabel({ away: 10, home: 21 })).toBe('10–21');
    expect(compactScoreLabel({ away: 0, home: 0 })).toBe('0–0');
  });
});

describe('downDistanceLabel', () => {
  it('formats 1–4 downs', () => {
    expect(downDistanceLabel(1, 10)).toBe('1st & 10');
    expect(downDistanceLabel(2, 7)).toBe('2nd & 7');
    expect(downDistanceLabel(3, 1)).toBe('3rd & 1');
    expect(downDistanceLabel(4, 2)).toBe('4th & 2');
  });

  it('returns null when either input is missing or down is out of range', () => {
    expect(downDistanceLabel(null, 10)).toBeNull();
    expect(downDistanceLabel(1, null)).toBeNull();
    expect(downDistanceLabel(5, 10)).toBeNull();
  });
});

describe('fieldPositionLabel', () => {
  it('uses the possessing team abbreviation in own territory', () => {
    expect(fieldPositionLabel(68, 'IND', 'DEN')).toBe('IND 32');
  });

  it('uses the opponent abbreviation in opponent territory', () => {
    expect(fieldPositionLabel(32, 'IND', 'DEN')).toBe('DEN 32');
  });

  it('treats the 50-yard line as opponent territory (yardsToEndzone === 50)', () => {
    expect(fieldPositionLabel(50, 'IND', 'DEN')).toBe('DEN 50');
  });

  it('labels the goal line', () => {
    expect(fieldPositionLabel(0, 'IND', 'DEN')).toBe('DEN 0');
  });

  it('returns null when yardline or possession is missing', () => {
    expect(fieldPositionLabel(null, 'IND', 'DEN')).toBeNull();
    expect(fieldPositionLabel(32, null, 'DEN')).toBeNull();
  });

  it('returns null in opponent territory without an opponent abbreviation', () => {
    expect(fieldPositionLabel(32, 'IND', null)).toBeNull();
  });
});

describe('fieldGaugeMarkerPercent', () => {
  it('places the marker at the opponent goal when yardsToEndzone is 0', () => {
    expect(fieldGaugeMarkerPercent(0)).toBe(100);
  });

  it('places the marker at midfield when yardsToEndzone is 50', () => {
    expect(fieldGaugeMarkerPercent(50)).toBe(50);
  });

  it('places the marker 20% from the opponent goal when yardsToEndzone is 20', () => {
    expect(fieldGaugeMarkerPercent(20)).toBe(80);
  });

  it('places the marker at the own goal when yardsToEndzone is 100', () => {
    expect(fieldGaugeMarkerPercent(100)).toBe(0);
  });

  it('clamps out-of-range values', () => {
    expect(fieldGaugeMarkerPercent(-5)).toBe(100);
    expect(fieldGaugeMarkerPercent(120)).toBe(0);
  });
});

describe('fieldGaugeTickPercent', () => {
  it('places nine ticks at 10% through 90%', () => {
    expect(FIELD_GAUGE_TICK_LABELS).toEqual([10, 20, 30, 40, 50, 40, 30, 20, 10]);
    expect(FIELD_GAUGE_TICK_LABELS.map((_, i) => fieldGaugeTickPercent(i))).toEqual([
      10, 20, 30, 40, 50, 60, 70, 80, 90,
    ]);
  });

  it('keeps the red-zone geography at the opponent 20', () => {
    expect(FIELD_GAUGE_RED_ZONE_PERCENT).toBe(20);
  });

  it('places unlabeled 5-yard hashes between each major tick', () => {
    expect(FIELD_GAUGE_MINOR_TICK_PERCENTS).toEqual([5, 15, 25, 35, 45, 55, 65, 75, 85, 95]);
    for (const percent of FIELD_GAUGE_MINOR_TICK_PERCENTS) {
      expect(percent % 10).toBe(5);
    }
  });
});

describe('fieldGaugeShowsRedZone', () => {
  it('is true at or inside the 20', () => {
    expect(fieldGaugeShowsRedZone(20)).toBe(true);
    expect(fieldGaugeShowsRedZone(5)).toBe(true);
    expect(fieldGaugeShowsRedZone(0)).toBe(true);
  });

  it('is false outside the 20', () => {
    expect(fieldGaugeShowsRedZone(21)).toBe(false);
    expect(fieldGaugeShowsRedZone(50)).toBe(false);
  });
});

function option(
  service: string,
  preferred: boolean,
  overrides: Partial<GameBroadcast> = {},
): GameBroadcast {
  return {
    service,
    deep_link_url: `https://x/${service}`,
    requires_subscription: true,
    user_has_subscription: true,
    typical_lag_seconds: 30,
    preferred,
    network: 'fox',
    market_confidence: 'unknown',
    ...overrides,
  };
}

describe('pickPreferredBroadcast', () => {
  const b = option;

  it('returns the preferred broadcast when present', () => {
    expect(
      pickPreferredBroadcast([b('youtube_tv', false), b('sunday_ticket', true)])?.service,
    ).toBe('sunday_ticket');
  });

  it('falls back to the first broadcast when none is preferred', () => {
    expect(
      pickPreferredBroadcast([b('youtube_tv', false), b('sunday_ticket', false)])?.service,
    ).toBe('youtube_tv');
  });

  it('returns null for an empty list', () => {
    expect(pickPreferredBroadcast([])).toBeNull();
  });
});

describe('watchCta', () => {
  const fox = [{ network: 'fox' }];

  it('offers the preferred option when the user has one', () => {
    const yttv = option('youtube_tv', true);
    expect(watchCta([yttv], fox)).toEqual({ kind: 'watch', broadcast: yttv });
  });

  it('falls back to the airing as plain text with no options', () => {
    expect(watchCta([], fox)).toEqual({ kind: 'airing', text: 'On FOX' });
  });

  it('uses the board token for the airing, ESPN over ABC', () => {
    expect(watchCta([], [{ network: 'abc' }, { network: 'espn' }])).toEqual({
      kind: 'airing',
      text: 'On ESPN',
    });
    expect(watchCta([], [{ network: 'amazon_prime' }])).toEqual({
      kind: 'airing',
      text: 'On PRIME',
    });
  });

  it('treats an option with no deep link as nothing to open', () => {
    expect(watchCta([option('sling', true, { deep_link_url: '' })], fox)).toEqual({
      kind: 'airing',
      text: 'On FOX',
    });
  });

  it('shows nothing when there is neither an option nor a known airing', () => {
    expect(watchCta([], [])).toEqual({ kind: 'none' });
    expect(watchCta([], [{ network: 'dumont' }])).toEqual({ kind: 'none' });
  });
});

describe('watchOptionParts', () => {
  it('gives a plain option a title and no caption', () => {
    expect(watchOptionParts(option('sunday_ticket', true))).toEqual({
      title: 'NFL Sunday Ticket',
      caption: null,
    });
  });

  it('splits the in-market local route into title and caption', () => {
    expect(
      watchOptionParts(option('youtube_tv', false, { route_hint: 'in_market_local' })),
    ).toEqual({ title: 'FOX on YouTube TV', caption: 'If this game is in your market' });
  });
});

describe('watchOptionLabel', () => {
  it('names a plain option by its service', () => {
    expect(watchOptionLabel(option('sunday_ticket', true))).toBe('NFL Sunday Ticket');
  });

  it('spells out when to use the in-market local route', () => {
    expect(watchOptionLabel(option('youtube_tv', false, { route_hint: 'in_market_local' }))).toBe(
      'FOX on YouTube TV — if this game is in your market',
    );
  });
});

describe('localRouteOption', () => {
  it('finds the option carrying the in-market hint', () => {
    const local = option('youtube_tv', false, { route_hint: 'in_market_local' });
    expect(localRouteOption([option('sunday_ticket', true), local])).toBe(local);
  });

  it('returns null without one', () => {
    expect(localRouteOption([option('youtube_tv', true)])).toBeNull();
  });
});

describe('matchupNicknameLabel', () => {
  it('uppercases nicknames', () => {
    expect(matchupNicknameLabel('Colts', 'Titans')).toBe('COLTS @ TITANS');
  });
});

describe('fieldAlignedMatchup', () => {
  const base = {
    home_team: 'BUF',
    away_team: 'DET',
    home_team_name: 'Bills',
    away_team_name: 'Lions',
    home_team_primary_color: '#00338D',
    away_team_primary_color: '#0076B6',
    score: { home: 14, away: 0 },
  };

  it('puts the possessing team on the left (own-goal side of the gauge)', () => {
    expect(fieldAlignedMatchup({ ...base, possession_team: 'BUF' })).toEqual({
      leftName: 'BILLS',
      rightName: 'LIONS',
      leftScore: 14,
      rightScore: 0,
      leftPrimaryColor: '#00338D',
      rightPrimaryColor: '#0076B6',
    });
  });

  it('flips sides when the away team has the ball', () => {
    expect(fieldAlignedMatchup({ ...base, possession_team: 'DET' })).toEqual({
      leftName: 'LIONS',
      rightName: 'BILLS',
      leftScore: 0,
      rightScore: 14,
      leftPrimaryColor: '#0076B6',
      rightPrimaryColor: '#00338D',
    });
  });

  it('falls back to away-left / home-right with no possession', () => {
    expect(fieldAlignedMatchup({ ...base, possession_team: null })).toEqual({
      leftName: 'LIONS',
      rightName: 'BILLS',
      leftScore: 0,
      rightScore: 14,
      leftPrimaryColor: '#0076B6',
      rightPrimaryColor: '#00338D',
    });
  });
});

describe('hexWithAlpha', () => {
  it('converts a 6-digit hex to rgba', () => {
    expect(hexWithAlpha('#00338D', 0.32)).toBe('rgba(0, 51, 141, 0.32)');
  });

  it('accepts 3-digit hex', () => {
    expect(hexWithAlpha('#f00', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('returns null for empty or invalid input', () => {
    expect(hexWithAlpha('', 0.3)).toBeNull();
    expect(hexWithAlpha('nope', 0.3)).toBeNull();
  });
});

describe('opponentAbbreviation', () => {
  it('returns the other team when someone has the ball', () => {
    expect(opponentAbbreviation('IND', 'TEN', 'IND')).toBe('TEN');
    expect(opponentAbbreviation('TEN', 'TEN', 'IND')).toBe('IND');
  });

  it('returns null when nobody has the ball', () => {
    expect(opponentAbbreviation(null, 'TEN', 'IND')).toBeNull();
  });
});

describe('gameClockLine', () => {
  it('always includes quarter and clock', () => {
    expect(gameClockLine(2, 434, null, null)).toBe('Q2 · 7:14');
  });

  it('appends down and distance when both are present', () => {
    expect(gameClockLine(2, 434, 1, 10)).toBe('Q2 · 7:14 · 1st & 10');
  });
});

describe('alsoFlaggedSituationLines', () => {
  const game = (overrides: Partial<GameSummary> = {}): GameSummary => ({
    home_team: 'NYJ',
    away_team: 'BUF',
    home_team_name: 'Jets',
    away_team_name: 'Bills',
    home_team_primary_color: '#125740',
    home_team_secondary_color: '#FFFFFF',
    away_team_primary_color: '#00338D',
    away_team_secondary_color: '#C60C30',
    score: { home: 10, away: 17 },
    quarter: 2,
    time_remaining_sec: 202,
    possession_team: 'BUF',
    yards_to_endzone: 52,
    down: 1,
    distance: 10,
    in_red_zone: false,
    ...overrides,
  });

  it('always includes the clock and omits null position / down-distance', () => {
    expect(
      alsoFlaggedSituationLines(
        game({ possession_team: null, yards_to_endzone: null, down: null, distance: null }),
      ),
    ).toEqual(['Q2 · 3:22']);
  });

  it('adds field position and down-distance when present', () => {
    expect(alsoFlaggedSituationLines(game())).toEqual(['Q2 · 3:22', 'BUF 48', '1st & 10']);
  });
});
