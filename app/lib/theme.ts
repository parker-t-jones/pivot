/**
 * Dark-mode-only design tokens for the Pivot client.
 * Screens import `theme` directly — no React context / light variant yet.
 */
export const theme = {
  colors: {
    background: '#0B0B0F',
    surface: '#1A1A20',
    surfaceRaised: '#22222A',
    border: '#2A2A32',
    textPrimary: '#FFFFFF',
    textSecondary: '#9A9AA3',
    textTertiary: '#6E6E78',
    accent: '#FFB020',
    accentPressed: '#E09A10',
    /** Accent at 18% opacity — reason-chip fill and secondary-button press wash. */
    accentMuted: 'rgba(255, 176, 32, 0.18)',
    onAccent: '#412402',
    danger: '#FF5A5A',
    /** Danger at 14% opacity — red-zone gauge fill and Settings disconnect chip. */
    dangerMuted: 'rgba(255, 90, 90, 0.14)',
    success: '#3ECf8E',
    /** Accent at 25% opacity — "active" panel stroke (UI-SPEC.md §2.1). */
    accentBorder: 'rgba(255, 176, 32, 0.25)',
    /** Accent at 15% opacity — shadow color for panelGlow below (UI-SPEC.md §2.3). */
    accentGlow: 'rgba(255, 176, 32, 0.15)',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    md2: 14,
    lg: 16,
    lg2: 20,
    xl: 24,
    xxl: 32,
    xxxl: 40,
    huge: 48,
  },
  radii: {
    sm: 8,
    md: 12,
    control: 10,
    lg: 16,
    hero: 20,
    pill: 999,
  },
  opacity: {
    disabled: 0.5,
  },
  effects: {
    panelBorderWidth: 1,
    /** "Active" amber glow for a card that owns the current flag/possession (UI-SPEC.md §2.3,
     *  §3.3). `elevation` is the Android fallback — RN `shadow*` props are iOS-only. */
    panelGlow: {
      shadowColor: '#FFB020',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.15,
      shadowRadius: 20,
      elevation: 8,
    },
  },
  type: {
    /** Bold + tight tracking — screen-level titles ("Home"). */
    title: { size: 26, weight: '700', lineHeight: 32, letterSpacing: -0.3 },
    heading: { size: 20, weight: '600', lineHeight: 26 },
    body: { size: 15, weight: '400', lineHeight: 21 },
    bodyStrong: { size: 15, weight: '500', lineHeight: 21 },
    caption: { size: 13, weight: '400', lineHeight: 18 },
    button: { size: 16, weight: '600', lineHeight: 22 },
    small: { size: 14, weight: '400', lineHeight: 20 },
    smallStrong: { size: 14, weight: '600', lineHeight: 20 },
    eyebrow: { size: 12, weight: '700', letterSpacing: 0.6 },
    /** Clock / field-position ticker line — `tabular-nums` so digits don't jitter as they change
     *  width (e.g. "7:14" → "7:09"), system font (no mono asset shipped). */
    ticker: { size: 13, weight: '500', letterSpacing: 0, fontVariant: ['tabular-nums'] },
    /** Bold + tight tracking + tabular-nums (score digits changing width shouldn't reflow). */
    score: { size: 22, weight: '700', lineHeight: 28, letterSpacing: -0.2, fontVariant: ['tabular-nums'] },
  },
} as const;

export type Theme = typeof theme;
