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
    success: '#3ECf8E',
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
  type: {
    title: { size: 26, weight: '600', lineHeight: 32 },
    heading: { size: 20, weight: '600', lineHeight: 26 },
    body: { size: 15, weight: '400', lineHeight: 21 },
    bodyStrong: { size: 15, weight: '500', lineHeight: 21 },
    caption: { size: 13, weight: '400', lineHeight: 18 },
    button: { size: 16, weight: '600', lineHeight: 22 },
    small: { size: 14, weight: '400', lineHeight: 20 },
    smallStrong: { size: 14, weight: '600', lineHeight: 20 },
    eyebrow: { size: 12, weight: '700', letterSpacing: 0.6 },
  },
} as const;

export type Theme = typeof theme;
