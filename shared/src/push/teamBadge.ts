/**
 * Team badge data for iOS rich push notifications: team color plus initials, the same look as the
 * app's `TeamBadge`. Initials and colors only, no logos or wordmarks.
 *
 * The dispatcher cannot import `app/lib/teamColors.ts`, so the 32 color pairs and the contrast rule
 * are mirrored here. `app/lib/teamBadgePushParity.test.ts` fails if they drift from the app.
 * The Notification Service Extension (`app/plugins/notification-service/`) draws whatever fill,
 * border and ink this module resolves; it carries no color table of its own.
 */

/** Key under the Expo `data` object that carries the badge. The extension reads this key. */
export const PUSH_TEAM_BADGE_KEY = 'pivot_badge';

export interface PushTeamBadge {
  /** Normalized abbreviation, e.g. `KC`. Also the initials drawn on the badge. */
  team: string;
  /** Initials drawn on the badge. */
  initials: string;
  /** Badge fill, `#RRGGBB`. */
  fill: string;
  /** Thin ring color, `#RRGGBB`. */
  border: string;
  /** Initials color, `#RRGGBB`. Clears 4.5:1 on `fill`. */
  ink: string;
}

interface Pair {
  primary: string;
  secondary: string;
}

/** Mirrors `TEAM_COLORS` in `app/lib/teamColors.ts`. */
const TEAM_PAIRS: Readonly<Record<string, Pair>> = {
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

/** Mirrors `BADGE_INK_COLOR` in `app/lib/teamColors.ts` (`theme.colors.textPrimary` / `background`). */
const INK_LIGHT = '#FFFFFF';
const INK_DARK = '#0B0B0F';
const MIN_CONTRAST = 4.5;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff)
  );
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Same rule as `initialsInk`: whichever ink clears 4.5:1, the higher ratio when both do. */
function inkFor(fill: string): string | null {
  const light = contrast(INK_LIGHT, fill);
  const dark = contrast(INK_DARK, fill);
  if (light >= MIN_CONTRAST && dark >= MIN_CONTRAST) return light >= dark ? INK_LIGHT : INK_DARK;
  if (light >= MIN_CONTRAST) return INK_LIGHT;
  if (dark >= MIN_CONTRAST) return INK_DARK;
  return null;
}

/**
 * Badge data for a team abbreviation, or `null` when the team is missing or not one of the 32.
 * Callers treat `null` as "send the plain notification".
 */
export function buildPushTeamBadge(abbr: string | null | undefined): PushTeamBadge | null {
  if (typeof abbr !== 'string') return null;
  const team = abbr.trim().toUpperCase();
  const pair = TEAM_PAIRS[team];
  if (!pair) return null;
  const primaryInk = inkFor(pair.primary);
  if (primaryInk !== null) {
    return { team, initials: team, fill: pair.primary, border: pair.secondary, ink: primaryInk };
  }
  const secondaryInk = inkFor(pair.secondary);
  if (secondaryInk !== null) {
    return { team, initials: team, fill: pair.secondary, border: pair.primary, ink: secondaryInk };
  }
  return null;
}

/**
 * Adds the badge to an Expo `data` object without changing the original. `data` that is not a plain
 * object (undefined, array, string) is returned untouched, so nothing a client already parses moves.
 */
export function withPushTeamBadge(data: unknown, badge: PushTeamBadge): unknown {
  if (data === undefined) return { [PUSH_TEAM_BADGE_KEY]: badge };
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data;
  return { ...(data as Record<string, unknown>), [PUSH_TEAM_BADGE_KEY]: badge };
}

/** Narrows stored JSON (a retried push) to a badge. Anything malformed is `null`, so a retry degrades. */
export function parsePushTeamBadge(value: unknown): PushTeamBadge | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const hex = /^#[0-9A-Fa-f]{6}$/;
  const { team, initials, fill, border, ink } = v;
  if (typeof team !== 'string' || typeof initials !== 'string') return null;
  if (typeof fill !== 'string' || !hex.test(fill)) return null;
  if (typeof border !== 'string' || !hex.test(border)) return null;
  if (typeof ink !== 'string' || !hex.test(ink)) return null;
  return { team, initials, fill, border, ink };
}
