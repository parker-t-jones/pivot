import { describe, expect, it } from 'vitest';
import { theme } from './theme';

describe('theme', () => {
  it('keeps existing color, spacing, radius, and type values unchanged', () => {
    expect(theme.colors.background).toBe('#0B0B0F');
    expect(theme.colors.surface).toBe('#1A1A20');
    expect(theme.colors.surfaceRaised).toBe('#22222A');
    expect(theme.colors.border).toBe('#2A2A32');
    expect(theme.colors.textPrimary).toBe('#FFFFFF');
    expect(theme.colors.textSecondary).toBe('#9A9AA3');
    expect(theme.colors.textTertiary).toBe('#6E6E78');
    expect(theme.colors.accent).toBe('#F5A018');
    expect(theme.colors.accentPressed).toBe('#D68C10');
    expect(theme.colors.accentMuted).toBe('rgba(245, 160, 24, 0.18)');
    expect(theme.colors.onAccent).toBe('#412402');
    expect(theme.colors.danger).toBe('#FF5A5A');
    expect(theme.colors.dangerMuted).toBe('rgba(255, 90, 90, 0.14)');
    expect(theme.colors.success).toBe('#3ECf8E');

    expect(theme.spacing.xs).toBe(4);
    expect(theme.spacing.sm).toBe(8);
    expect(theme.spacing.md).toBe(12);
    expect(theme.spacing.lg).toBe(16);
    expect(theme.spacing.xl).toBe(24);
    expect(theme.spacing.xxl).toBe(32);

    expect(theme.radii.sm).toBe(8);
    expect(theme.radii.md).toBe(12);
    expect(theme.radii.lg).toBe(16);
    expect(theme.radii.pill).toBe(999);

    expect(theme.type.title.size).toBe(26);
    expect(theme.type.title.weight).toBe('700');
    expect(theme.type.title.fontFamily).toBe('PlusJakartaSans_700Bold');
    expect(theme.type.heading.size).toBe(20);
    expect(theme.type.heading.weight).toBe('600');
    expect(theme.type.heading.fontFamily).toBe('PlusJakartaSans_600SemiBold');
    expect(theme.type.body.size).toBe(15);
    expect(theme.type.body.weight).toBe('400');
    expect(theme.type.bodyStrong.size).toBe(15);
    expect(theme.type.bodyStrong.weight).toBe('500');
    expect(theme.type.caption.size).toBe(13);
    expect(theme.type.caption.weight).toBe('400');
  });

  it('adds the adoption-pass spacing, radius, opacity, and type steps', () => {
    expect(theme.spacing.md2).toBe(14);
    expect(theme.spacing.lg2).toBe(20);
    expect(theme.spacing.xxxl).toBe(40);
    expect(theme.spacing.huge).toBe(48);

    expect(theme.radii.control).toBe(10);
    expect(theme.radii.hero).toBe(20);

    expect(theme.opacity.disabled).toBe(0.5);

    expect(theme.type.title.lineHeight).toBe(32);
    expect(theme.type.title.letterSpacing).toBe(-0.3);
    expect(theme.type.heading.lineHeight).toBe(26);
    expect(theme.type.body.lineHeight).toBe(21);
    expect(theme.type.bodyStrong.lineHeight).toBe(21);
    expect(theme.type.caption.lineHeight).toBe(18);

    expect(theme.type.button).toEqual({ size: 16, weight: '600', lineHeight: 22 });
    expect(theme.type.small).toEqual({ size: 14, weight: '400', lineHeight: 20 });
    expect(theme.type.smallStrong).toEqual({ size: 14, weight: '600', lineHeight: 20 });
    expect(theme.type.eyebrow).toEqual({
      size: 12,
      weight: '700',
      letterSpacing: 0.6,
      fontFamily: 'JetBrainsMono_700Bold',
    });
  });

  it('uses tabular-nums + tight tracking for live-updating numbers (UI-SPEC.md §2.4)', () => {
    expect(theme.type.ticker).toEqual({
      size: 13,
      weight: '500',
      letterSpacing: 0,
      fontVariant: ['tabular-nums'],
      fontFamily: 'JetBrainsMono_500Medium',
    });
    expect(theme.type.score).toEqual({
      size: 22,
      weight: '700',
      lineHeight: 28,
      letterSpacing: -0.2,
      fontVariant: ['tabular-nums'],
      fontFamily: 'PlusJakartaSans_700Bold',
    });
  });

  it('pairs Plus Jakarta Sans headers/scores with JetBrains Mono metrics (type trial)', () => {
    expect(theme.type.title.fontFamily).toBe('PlusJakartaSans_700Bold');
    expect(theme.type.heading.fontFamily).toBe('PlusJakartaSans_600SemiBold');
    expect(theme.type.score.fontFamily).toBe('PlusJakartaSans_700Bold');
  });

  it('adds the UI-SPEC.md §2 border/glow tokens', () => {
    expect(theme.colors.accentBorder).toBe('rgba(245, 160, 24, 0.25)');
    expect(theme.colors.accentGlow).toBe('rgba(245, 160, 24, 0.15)');

    expect(theme.effects.panelBorderWidth).toBe(1);
    expect(theme.effects.panelGlow).toEqual({
      shadowColor: '#F5A018',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.15,
      shadowRadius: 20,
      elevation: 8,
    });
  });

  it('adds the amber-ladder tokens (PIVOT-STAKES-PLAN.md §11.1)', () => {
    expect(theme.colors.ember).toBe('rgba(245, 160, 24, 0.05)');
    expect(theme.colors.emberSolid).toBe('#17120F');
    expect(theme.colors.brass).toBe('#A07C38');
    expect(theme.colors.flare).toBe('#FFC94D');
    expect(theme.colors.well).toBe('#070709');
    expect(theme.colors.wellBorder).toBe('#1E1E25');
    expect(theme.colors.rowDivider).toBe('#16161B');

    expect(theme.effects.flareGlow).toEqual({
      shadowColor: '#FFC94D',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.25,
      shadowRadius: 24,
      elevation: 10,
    });
  });
});
