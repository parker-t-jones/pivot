/** Web window tiers. Native never reads these; the iPhone layout is the companion tree. */
export const DESKTOP_MEDIUM_MIN = 900;
export const DESKTOP_WIDE_MIN = 1280;
/** The sidebar, the page, and the right column together stop here and sit in the middle. */
export const DESKTOP_MAX_WIDTH = 1440;
export const DESKTOP_RIGHT_COLUMN = 360;
export const DESKTOP_RAIL_WIDTH = 72;
export const DESKTOP_SIDEBAR_WIDTH = 232;

export type DesktopTier = 'companion' | 'medium' | 'wide';

/**
 * Companion is the phone composition, including a window snapped beside a broadcast.
 * Medium is an icon rail plus two panes. Wide adds labels and the right column's room.
 */
export function desktopTier(width: number): DesktopTier {
  if (width >= DESKTOP_WIDE_MIN) return 'wide';
  if (width >= DESKTOP_MEDIUM_MIN) return 'medium';
  return 'companion';
}
