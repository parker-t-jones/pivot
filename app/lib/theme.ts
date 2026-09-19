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
    accent: '#F5A018',
    accentPressed: '#D68C10',
    /** Accent at 18% opacity — reason-chip fill and secondary-button press wash. */
    accentMuted: 'rgba(245, 160, 24, 0.18)',
    onAccent: '#412402',
    danger: '#FF5A5A',
    /** Danger at 14% opacity — red-zone gauge fill and Settings disconnect chip. */
    dangerMuted: 'rgba(255, 90, 90, 0.14)',
    success: '#3ECf8E',
    /** Accent at 25% opacity — "active" panel stroke (UI-SPEC.md §2.1). */
    accentBorder: 'rgba(245, 160, 24, 0.25)',
    /** Accent at 15% opacity — shadow color for panelGlow below (UI-SPEC.md §2.3). */
    accentGlow: 'rgba(245, 160, 24, 0.15)',
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
      shadowColor: '#F5A018',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.15,
      shadowRadius: 20,
      elevation: 8,
    },
  },
  type: {
    /** Bold + tight tracking — screen-level titles ("Home"). Plus Jakarta Sans trial. */
    title: {
      size: 26,
      weight: '700' as const,
      lineHeight: 32,
      letterSpacing: -0.3,
      fontFamily: 'PlusJakartaSans_700Bold',
    },
    heading: {
      size: 20,
      weight: '600' as const,
      lineHeight: 26,
      fontFamily: 'PlusJakartaSans_600SemiBold',
    },
    body: { size: 15, weight: '400', lineHeight: 21 },
    bodyStrong: { size: 15, weight: '500', lineHeight: 21 },
    caption: { size: 13, weight: '400', lineHeight: 18 },
    button: { size: 16, weight: '600', lineHeight: 22 },
    small: { size: 14, weight: '400', lineHeight: 20 },
    smallStrong: { size: 14, weight: '600', lineHeight: 20 },
    /** "Now active" / section eyebrows — JetBrains Mono trial. */
    eyebrow: {
      size: 12,
      weight: '700' as const,
      letterSpacing: 0.6,
      fontFamily: 'JetBrainsMono_700Bold',
    },
    /** Clock / field-position ticker — JetBrains Mono + tabular-nums. */
    ticker: {
      size: 13,
      weight: '500' as const,
      letterSpacing: 0,
      fontVariant: ['tabular-nums'] as const,
      fontFamily: 'JetBrainsMono_500Medium',
    },
    /** Score digits — Plus Jakarta Sans + tabular-nums (same family as team names). */
    score: {
      size: 22,
      weight: '700' as const,
      lineHeight: 28,
      letterSpacing: -0.2,
      fontVariant: ['tabular-nums'] as const,
      fontFamily: 'PlusJakartaSans_700Bold',
    },
  },
} as const;

export type Theme = typeof theme;
