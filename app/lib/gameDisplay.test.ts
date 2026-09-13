import { describe, expect, it } from 'vitest';
import {
  formatClock,
  pickPreferredBroadcast,
  quarterLabel,
  reasonLabel,
  serviceLabel,
  downDistanceLabel,
  fieldPositionLabel,
  fieldGaugeMarkerPercent,
  fieldGaugeShowsRedZone,
  type GameBroadcast,
} from './gameDisplay';

describe('serviceLabel', () => {
  it('maps known services to display names', () => {
    expect(serviceLabel('sunday_ticket')).toBe('Sunday Ticket');
    expect(serviceLabel('espn_plus')).toBe('ESPN+');
    expect(serviceLabel('fox')).toBe('FOX');
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
