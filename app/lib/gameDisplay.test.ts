import { describe, expect, it } from 'vitest';
import {
  alsoFlaggedSituationLines,
  formatClock,
  pickPreferredBroadcast,
  quarterLabel,
  reasonLabel,
  serviceLabel,
  downDistanceLabel,
  fieldPositionLabel,
  fieldGaugeMarkerPercent,
  fieldGaugeShowsRedZone,
  FIELD_GAUGE_RED_ZONE_PERCENT,
  FIELD_GAUGE_TICK_LABELS,
  fieldGaugeTickPercent,
  gameClockLine,
  matchupNicknameLabel,
  opponentAbbreviation,
  type GameBroadcast,
} from './gameDisplay';
import type { GameSummary } from './flagEventPayload';

describe('serviceLabel', () => {
  it('maps known services to display names', () => {
    expect(serviceLabel('sunday_ticket')).toBe('YouTube TV');
    expect(serviceLabel('espn_plus')).toBe('ESPN+');
    expect(serviceLabel('fox')).toBe('FOX');
    expect(serviceLabel('hulu')).toBe('Hulu');
    expect(serviceLabel('fubo')).toBe('Fubo');
    expect(serviceLabel('directv')).toBe('DIRECTV');
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

describe('pickPreferredBroadcast', () => {
  const b = (service: string, preferred: boolean): GameBroadcast => ({
    service,
    deep_link_url: `https://x/${service}`,
    requires_subscription: false,
    user_has_subscription: true,
    typical_lag_seconds: 8,
    preferred,
  });

  it('returns the preferred broadcast when present', () => {
    expect(pickPreferredBroadcast([b('fox', false), b('cbs', true)])?.service).toBe('cbs');
  });

  it('falls back to the first broadcast when none is preferred', () => {
    expect(pickPreferredBroadcast([b('fox', false), b('cbs', false)])?.service).toBe('fox');
  });

  it('returns null for an empty list', () => {
    expect(pickPreferredBroadcast([])).toBeNull();
  });
});

describe('matchupNicknameLabel', () => {
  it('uppercases nicknames', () => {
    expect(matchupNicknameLabel('Colts', 'Titans')).toBe('COLTS @ TITANS');
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
