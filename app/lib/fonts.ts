import {
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import {
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';

/**
 * Temporary type trial — Plus Jakarta Sans for team nicknames / scores; Space Grotesk on the
 * Watch CTA; JetBrains Mono for live metrics (yardage / clock / down / active pills / Home chrome).
 * Loaded in `app/_layout.tsx`.
 */
export const fonts = {
  /** Watch CTA label (kept on Space Grotesk after nicknames moved back to Jakarta). */
  teamNickname: 'SpaceGrotesk_700Bold',
  /** Team nicknames, screen titles, scores. */
  sansBold: 'PlusJakartaSans_700Bold',
  /** Section headings. */
  sansSemiBold: 'PlusJakartaSans_600SemiBold',
  /** Eyebrows / "Now active" / Home header chrome. */
  monoBold: 'JetBrainsMono_700Bold',
  /** Reason chips (active pill). */
  monoSemiBold: 'JetBrainsMono_600SemiBold',
  /** Field-gauge ticker, yard labels, situation lines. */
  monoMedium: 'JetBrainsMono_500Medium',
} as const;

/** Pass to `useFonts` in the root layout. */
export const displayFontMap = {
  SpaceGrotesk_700Bold,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
  JetBrainsMono_700Bold,
};
