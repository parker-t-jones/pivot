import { describe, expect, it } from 'vitest';

import {
  FILLED_BUTTON_RECIPE,
  LIST_ROW_RECIPE,
  TEXT_BUTTON_HIT_SLOP,
  TEXT_FIELD_RECIPE,
} from './controlRecipes';
import { theme } from './theme';

describe('controlRecipes', () => {
  it('uses the canonical primary/secondary chrome', () => {
    expect(FILLED_BUTTON_RECIPE).toEqual({
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md2,
    });
  });

  it('uses the borderless text-field chrome', () => {
    expect(TEXT_FIELD_RECIPE.borderRadius).toBe(theme.radii.control);
    expect(TEXT_FIELD_RECIPE.paddingHorizontal).toBe(theme.spacing.lg);
    expect(TEXT_FIELD_RECIPE.paddingVertical).toBe(theme.spacing.md2);
    expect(TEXT_FIELD_RECIPE.fontSize).toBe(theme.type.button.size);
  });

  it('merges list rows onto control radius and md/md2 padding', () => {
    expect(LIST_ROW_RECIPE).toEqual({
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.md2,
      paddingVertical: theme.spacing.md,
    });
  });

  it('extends text-link hit targets to 44pt without visible padding', () => {
    expect(TEXT_BUTTON_HIT_SLOP.top + TEXT_BUTTON_HIT_SLOP.bottom + theme.type.button.size).toBe(
      44,
    );
  });
});
