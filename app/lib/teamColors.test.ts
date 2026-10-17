import { describe, expect, it } from 'vitest';

import { theme } from './theme';
import {
  BADGE_INK_COLOR,
  FALLBACK_TEAM_COLORS,
  NFL_TEAM_ABBREVIATIONS,
  SECONDARY_FILL_TEAMS,
  TEAM_COLORS,
  badgeColors,
  contrastRatio,
  getTeamColors,
  initialsInk,
  resolveBadgeColors,
  teamName,
  type NflTeamAbbreviation,
} from './teamColors';

/**
 * `teams.abbreviation` from `supabase/seed.sql` — the set that reaches the client.
 * ESPN `WSH` is normalized to `WAS` before that; Sleeper `LA` / `JAC` are not in this set.
 */
const CANONICAL_ABBREVIATIONS = [
  'ARI',
  'ATL',
  'BAL',
  'BUF',
  'CAR',
  'CHI',
  'CIN',
  'CLE',
  'DAL',
  'DEN',
  'DET',
  'GB',
  'HOU',
  'IND',
  'JAX',
  'KC',
  'LAC',
  'LAR',
  'LV',
  'MIA',
  'MIN',
  'NE',
  'NO',
  'NYG',
  'NYJ',
  'PHI',
  'PIT',
  'SEA',
  'SF',
  'TB',
  'TEN',
  'WAS',
] as const;

/** Independent of `contrastRatio`, so a stubbed helper cannot satisfy the 4.5:1 assertion. */
function wcagContrast(foreground: string, background: string): number {
  const luminance = (hex: string): number => {
    const raw = hex.replace('#', '');
    const channel = (start: number): number => {
      const value = Number.parseInt(raw.slice(start, start + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe('TEAM_COLORS', () => {
  it('has exactly the client abbreviation set and no extra keys', () => {
    expect([...NFL_TEAM_ABBREVIATIONS].sort()).toEqual([...CANONICAL_ABBREVIATIONS].sort());
    expect(Object.keys(TEAM_COLORS).sort()).toEqual([...CANONICAL_ABBREVIATIONS].sort());
    expect(CANONICAL_ABBREVIATIONS).toHaveLength(32);
    for (const omitted of ['WSH', 'LA', 'JAC', 'OAK', 'SD', 'STL']) {
      expect(Object.keys(TEAM_COLORS)).not.toContain(omitted);
    }
  });

  it('stores a primary and secondary hex for every team', () => {
    for (const abbreviation of CANONICAL_ABBREVIATIONS) {
      const colors = TEAM_COLORS[abbreviation];
      expect(colors.primary).toMatch(/^#[0-9A-F]{6}$/);
      expect(colors.secondary).toMatch(/^#[0-9A-F]{6}$/);
      expect(teamName(abbreviation)?.length).toBeGreaterThan(0);
    }
  });
});

describe('getTeamColors', () => {
  it('resolves the canonical abbreviation regardless of case or surrounding space', () => {
    expect(getTeamColors('kc')).toBe(TEAM_COLORS.KC);
    expect(getTeamColors('  Was  ')).toBe(TEAM_COLORS.WAS);
    expect(getTeamColors('LAR')).toEqual({ primary: '#003594', secondary: '#FFD100' });
  });

  it('returns the theme fallback for unknown abbreviations and does not throw', () => {
    expect(FALLBACK_TEAM_COLORS).toEqual({
      primary: theme.colors.surface,
      secondary: theme.colors.border,
    });
    for (const abbreviation of ['WSH', 'LA', 'JAC', '', '   ', 'nope']) {
      expect(() => getTeamColors(abbreviation)).not.toThrow();
      expect(getTeamColors(abbreviation)).toBe(FALLBACK_TEAM_COLORS);
    }
    expect(() => getTeamColors(null as unknown as string)).not.toThrow();
    expect(getTeamColors(null as unknown as string)).toBe(FALLBACK_TEAM_COLORS);
  });
});

describe('initials contrast', () => {
  it('clears 4.5:1 for every team text/fill pair', () => {
    expect(SECONDARY_FILL_TEAMS).toEqual([]);
    for (const abbreviation of CANONICAL_ABBREVIATIONS) {
      const badge = badgeColors(abbreviation);
      expect(badge.usesSecondaryFill).toBe(false);
      expect(badge.fill).toBe(TEAM_COLORS[abbreviation].primary);
      expect(badge.border).toBe(TEAM_COLORS[abbreviation].secondary);
      expect(badge.textColor).toBe(BADGE_INK_COLOR[badge.ink]);
      expect(wcagContrast(badge.textColor, badge.fill)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(badge.textColor, badge.fill)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses the secondary as the fill when neither ink clears the primary', () => {
    expect(initialsInk('#777777')).toBeNull();
    const flipped = resolveBadgeColors({ primary: '#777777', secondary: '#000000' });
    expect(flipped.usesSecondaryFill).toBe(true);
    expect(flipped.fill).toBe('#000000');
    expect(flipped.border).toBe('#777777');
    expect(wcagContrast(flipped.textColor, flipped.fill)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the fallback pair above 4.5:1', () => {
    const badge = badgeColors('WSH');
    expect(badge.fill).toBe(theme.colors.surface);
    expect(badge.border).toBe(theme.colors.border);
    expect(wcagContrast(badge.textColor, badge.fill)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('teamName', () => {
  it('returns the nickname for a known abbreviation and null otherwise', () => {
    const abbreviation: NflTeamAbbreviation = 'JAX';
    expect(teamName(abbreviation)).toBe('Jaguars');
    expect(teamName('wsh')).toBeNull();
  });
});
