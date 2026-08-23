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
    onAccent: '#412402',
    danger: '#FF5A5A',
    success: '#3ECf8E',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },
  radii: {
    sm: 8,
    md: 12,
    lg: 16,
    pill: 999,
  },
  type: {
    title: { size: 26, weight: '600' },
    heading: { size: 20, weight: '600' },
    body: { size: 15, weight: '400' },
    bodyStrong: { size: 15, weight: '500' },
    caption: { size: 13, weight: '400' },
  },
} as const;

export type Theme = typeof theme;
