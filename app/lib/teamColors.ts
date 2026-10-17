/**
 * NFL team colors for client badges. Keys are the abbreviation set the app already
 * receives: `teams.abbreviation` in `supabase/seed.sql` (WAS, not ESPN's WSH; LAR, not LA;
 * JAX; LV). Ingestion maps ESPN `WSH` → `WAS` before those rows are stored or sent.
 *
 * Hex values are published team colors (nflverse `team_color` / `team_color2`).
 * Initials and colors only — no logos, wordmarks, or other artwork.
 *
 * The Now Active card does not read this module. Its score washes come from
 * `game_summary` `*_team_primary_color`, which the API fills from `teams.primary_color`.
 */
import { theme } from './theme';

export const NFL_TEAM_ABBREVIATIONS = [
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

export type NflTeamAbbreviation = (typeof NFL_TEAM_ABBREVIATIONS)[number];

export interface TeamColors {
  primary: string;
  secondary: string;
}

/** Neutral badge when the abbreviation is missing or not one of the 32. */
export const FALLBACK_TEAM_COLORS: TeamColors = {
  primary: theme.colors.surface,
  secondary: theme.colors.border,
};

export const TEAM_COLORS: Record<NflTeamAbbreviation, TeamColors> = {
  ARI: { primary: '#97233F', secondary: '#000000' },
  ATL: { primary: '#A71930', secondary: '#000000' },
  BAL: { primary: '#241773', secondary: '#9E7C0C' },
  BUF: { primary: '#00338D', secondary: '#C60C30' },
  CAR: { primary: '#0085CA', secondary: '#000000' },
  CHI: { primary: '#0B162A', secondary: '#E64100' },
  CIN: { primary: '#FB4F14', secondary: '#000000' },
  CLE: { primary: '#FF3C00', secondary: '#311D00' },
  DAL: { primary: '#002244', secondary: '#B0B7BC' },
  DEN: { primary: '#002244', secondary: '#FB4F14' },
  DET: { primary: '#0076B6', secondary: '#B0B7BC' },
  GB: { primary: '#203731', secondary: '#FFB612' },
  HOU: { primary: '#03202F', secondary: '#A71930' },
  IND: { primary: '#002C5F', secondary: '#A5ACAF' },
  JAX: { primary: '#006778', secondary: '#000000' },
  KC: { primary: '#E31837', secondary: '#FFB612' },
  LAC: { primary: '#007BC7', secondary: '#FFC20E' },
  LAR: { primary: '#003594', secondary: '#FFD100' },
  LV: { primary: '#000000', secondary: '#A5ACAF' },
  MIA: { primary: '#008E97', secondary: '#F58220' },
  MIN: { primary: '#4F2683', secondary: '#FFC62F' },
  NE: { primary: '#002244', secondary: '#C60C30' },
  NO: { primary: '#D3BC8D', secondary: '#000000' },
  NYG: { primary: '#0B2265', secondary: '#A71930' },
  NYJ: { primary: '#003F2D', secondary: '#000000' },
  PHI: { primary: '#004C54', secondary: '#A5ACAF' },
  PIT: { primary: '#000000', secondary: '#FFB612' },
  SEA: { primary: '#002244', secondary: '#69BE28' },
  SF: { primary: '#AA0000', secondary: '#B3995D' },
  TB: { primary: '#A71930', secondary: '#322F2B' },
  TEN: { primary: '#4495D2', secondary: '#D50A0A' },
  WAS: { primary: '#5A1414', secondary: '#FFB612' },
};

/** Nicknames, matching `teams.name`, for the badge accessible label. */
const TEAM_NAMES: Record<NflTeamAbbreviation, string> = {
  ARI: 'Cardinals',
  ATL: 'Falcons',
  BAL: 'Ravens',
  BUF: 'Bills',
  CAR: 'Panthers',
  CHI: 'Bears',
  CIN: 'Bengals',
  CLE: 'Browns',
  DAL: 'Cowboys',
  DEN: 'Broncos',
  DET: 'Lions',
  GB: 'Packers',
  HOU: 'Texans',
  IND: 'Colts',
  JAX: 'Jaguars',
  KC: 'Chiefs',
  LAC: 'Chargers',
  LAR: 'Rams',
  LV: 'Raiders',
  MIA: 'Dolphins',
  MIN: 'Vikings',
  NE: 'Patriots',
  NO: 'Saints',
  NYG: 'Giants',
  NYJ: 'Jets',
  PHI: 'Eagles',
  PIT: 'Steelers',
  SEA: 'Seahawks',
  SF: '49ers',
  TB: 'Buccaneers',
  TEN: 'Titans',
  WAS: 'Commanders',
};

const KNOWN_ABBREVIATIONS: ReadonlySet<string> = new Set(NFL_TEAM_ABBREVIATIONS);

export type BadgeInk = 'light' | 'dark';

/** Initials ink. Light is `textPrimary`; dark is `background`, the near-black token. */
export const BADGE_INK_COLOR: Record<BadgeInk, string> = {
  light: theme.colors.textPrimary,
  dark: theme.colors.background,
};

const MIN_CONTRAST = 4.5;

export interface BadgeColors {
  fill: string;
  border: string;
  ink: BadgeInk;
  textColor: string;
  /** True when the primary failed 4.5:1 for both inks and the secondary is the fill. */
  usesSecondaryFill: boolean;
}

function normalizeAbbreviation(abbr: string): string {
  if (typeof abbr !== 'string') return '';
  return abbr.trim().toUpperCase();
}

function isNflTeamAbbreviation(value: string): value is NflTeamAbbreviation {
  return KNOWN_ABBREVIATIONS.has(value);
}

/** Team nickname when `abbr` is one of the 32, otherwise null. */
export function teamName(abbr: string): string | null {
  const key = normalizeAbbreviation(abbr);
  return isNflTeamAbbreviation(key) ? TEAM_NAMES[key] : null;
}

/** Colors for `abbr`. Unknown, blank, or non-string input returns the theme fallback. */
export function getTeamColors(abbr: string): TeamColors {
  const key = normalizeAbbreviation(abbr);
  if (!isNflTeamAbbreviation(key)) return FALLBACK_TEAM_COLORS;
  return TEAM_COLORS[key];
}

function parseHex(hex: string): readonly [number, number, number] | null {
  if (typeof hex !== 'string') return null;
  const raw = hex.trim().replace(/^#/, '');
  const full = raw.length === 3 ? raw.replace(/./g, (channel) => channel + channel) : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

function srgbChannel(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number | null {
  const channels = parseHex(hex);
  if (channels === null) return null;
  const [red, green, blue] = channels;
  return 0.2126 * srgbChannel(red) + 0.7152 * srgbChannel(green) + 0.0722 * srgbChannel(blue);
}

/** WCAG contrast ratio. Unparseable hex returns 0 so callers can fall through instead of throwing. */
export function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  if (foregroundLuminance === null || backgroundLuminance === null) return 0;
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Light or dark initials on `fill` when that pair clears 4.5:1. Null when neither does.
 * When both pass, the higher ratio wins.
 */
export function initialsInk(fill: string): BadgeInk | null {
  const light = contrastRatio(BADGE_INK_COLOR.light, fill);
  const dark = contrastRatio(BADGE_INK_COLOR.dark, fill);
  if (light >= MIN_CONTRAST && dark >= MIN_CONTRAST) return light >= dark ? 'light' : 'dark';
  if (light >= MIN_CONTRAST) return 'light';
  if (dark >= MIN_CONTRAST) return 'dark';
  return null;
}

function treatment(fill: string, border: string, usesSecondaryFill: boolean): BadgeColors | null {
  const ink = initialsInk(fill);
  if (ink === null) return null;
  return {
    fill,
    border,
    ink,
    textColor: BADGE_INK_COLOR[ink],
    usesSecondaryFill,
  };
}

/**
 * Badge fill, ring, and initials ink for a primary/secondary pair.
 * Uses the secondary as the fill when neither ink clears 4.5:1 on the primary.
 * If the secondary fails too, returns the theme fallback (which does clear).
 */
export function resolveBadgeColors(colors: TeamColors): BadgeColors {
  return (
    treatment(colors.primary, colors.secondary, false) ??
    treatment(colors.secondary, colors.primary, true) ??
    treatment(FALLBACK_TEAM_COLORS.primary, FALLBACK_TEAM_COLORS.secondary, false) ?? {
      fill: FALLBACK_TEAM_COLORS.primary,
      border: FALLBACK_TEAM_COLORS.secondary,
      ink: 'light',
      textColor: BADGE_INK_COLOR.light,
      usesSecondaryFill: false,
    }
  );
}

/** `resolveBadgeColors` for an abbreviation, including the neutral fallback. */
export function badgeColors(abbr: string): BadgeColors {
  return resolveBadgeColors(getTeamColors(abbr));
}

/**
 * Teams whose badge fill is the secondary because the primary fails both inks.
 * None of the current 32 primaries fail, so this stays empty.
 */
export const SECONDARY_FILL_TEAMS: readonly NflTeamAbbreviation[] = NFL_TEAM_ABBREVIATIONS.filter(
  (abbreviation) => badgeColors(abbreviation).usesSecondaryFill,
);
