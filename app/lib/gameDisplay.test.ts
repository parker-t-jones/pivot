import { describe, expect, it } from 'vitest';
import {
  formatClock,
  pickPreferredBroadcast,
  quarterLabel,
  reasonLabel,
  serviceLabel,
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
