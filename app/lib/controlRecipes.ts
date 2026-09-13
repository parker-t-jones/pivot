import { theme } from './theme';

/** Invisible inset that grows a ~16pt label to a 44pt hit target without visible padding. */
export const TEXT_BUTTON_HIT_SLOP = {
  top: 14,
  bottom: 14,
  left: 12,
  right: 12,
} as const;

export const LIST_ROW_RECIPE = {
  backgroundColor: theme.colors.surface,
  borderRadius: theme.radii.control,
  paddingHorizontal: theme.spacing.md2,
  paddingVertical: theme.spacing.md,
} as const;

export const TEXT_FIELD_RECIPE = {
  backgroundColor: theme.colors.surface,
  borderRadius: theme.radii.control,
  color: theme.colors.textPrimary,
  fontSize: theme.type.button.size,
  paddingHorizontal: theme.spacing.lg,
  paddingVertical: theme.spacing.md2,
} as const;

export const FILLED_BUTTON_RECIPE = {
  borderRadius: theme.radii.control,
  paddingHorizontal: theme.spacing.lg,
  paddingVertical: theme.spacing.md2,
} as const;
