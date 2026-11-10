import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PickCard } from './PickCard';
import { YourLiveGames } from './LiveStakeGameCard';
import { DEMO_WATCH_HINT } from '../lib/demoGameDay';
import type { LiveStakeCardModel } from '../lib/liveStakeCards';
import type { PickCardModel } from '../lib/pickCard';
import { theme } from '../lib/theme';

export interface DemoPickCard {
  id: string;
  model: PickCardModel;
}

/** How long the demo-only hint under the Watch button stays up. */
export const DEMO_WATCH_HINT_MS = 4_000;

/**
 * The demo's live view (issue #71): Home on a live game day. The "LIVE" eyebrow and "Home" title,
 * then the real `YourLiveGames` / `LiveStakeGameCard` (NOW ACTIVE hero with the field-aligned
 * teams, split score, numbered field gauge, on-field chip and Watch button) fed a fixture model,
 * then "YOUR PICKS" with the shared `PickCard`s, so the hit state a person sees is the one the
 * real Watchlist draws (#67).
 *
 * The Watch button must open nothing: `onSwitch` here only shows a short demo-only hint. No link,
 * no `Linking`, no broadcast resolver, no API call. The header mirrors `LiveModeEyebrow` and
 * `HomeDashboard`'s title with the same tokens (importing `HomeLiveView` / `HomeDashboard` would
 * pull in the router, the board and the segment storage, which the demo must not run). The board
 * and "Also flagged" rows describe other games, and the demo has one, so they are left out.
 */
export function DemoHomeLive({
  games,
  picks,
}: {
  games: readonly LiveStakeCardModel[];
  picks: readonly DemoPickCard[];
}) {
  const [hintVisible, setHintVisible] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (hintTimer.current !== null) clearTimeout(hintTimer.current);
    },
    [],
  );

  const showHint = useCallback(() => {
    if (hintTimer.current !== null) clearTimeout(hintTimer.current);
    setHintVisible(true);
    hintTimer.current = setTimeout(() => {
      hintTimer.current = null;
      setHintVisible(false);
    }, DEMO_WATCH_HINT_MS);
  }, []);

  return (
    <View style={styles.screen} testID="demo-home-live">
      <View style={styles.headerBlock}>
        <Text
          maxFontSizeMultiplier={theme.fontScaleCaps.dense}
          style={styles.liveEyebrow}
          testID="demo-home-live-eyebrow"
        >
          {`● LIVE · ${games.length} ${games.length === 1 ? 'GAME' : 'GAMES'}`}
        </Text>
        <Text maxFontSizeMultiplier={theme.fontScaleCaps.title} style={styles.screenTitle}>
          Home
        </Text>
      </View>
      <View style={styles.hero} testID="demo-home-live-hero">
        <YourLiveGames cards={[...games]} onSwitch={showHint} />
        {hintVisible ? (
          <Text
            accessibilityLiveRegion="polite"
            maxFontSizeMultiplier={theme.fontScaleCaps.dense}
            style={styles.hint}
            testID="demo-watch-hint"
          >
            {DEMO_WATCH_HINT}
          </Text>
        ) : null}
      </View>
      <View style={styles.section} testID="demo-home-live-picks">
        <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.eyebrow}>
          {`YOUR PICKS · ${picks.length}`}
        </Text>
        {picks.map((pick) => (
          <PickCard key={pick.id} model={pick.model} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    textTransform: 'uppercase',
  },
  headerBlock: {
    gap: theme.spacing.xs,
  },
  hero: {
    gap: theme.spacing.sm,
    width: '100%',
  },
  hint: {
    color: theme.colors.textSecondary,
    fontFamily: theme.type.ticker.fontFamily,
    fontSize: theme.type.caption.size,
    textAlign: 'center',
  },
  liveEyebrow: {
    color: theme.colors.flare,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  screen: {
    gap: theme.spacing.lg,
    width: '100%',
  },
  screenTitle: {
    color: theme.colors.textPrimary,
    fontFamily: theme.type.title.fontFamily,
    fontSize: theme.type.title.size,
    letterSpacing: theme.type.title.letterSpacing,
  },
  section: {
    gap: theme.spacing.sm,
  },
});
