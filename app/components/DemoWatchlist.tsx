import { StyleSheet, Text, View } from 'react-native';

import { PickCard } from './PickCard';
import { fonts } from '../lib/fonts';
import type { PickCardModel } from '../lib/pickCard';
import { theme } from '../lib/theme';

export interface DemoWatchlistCard {
  id: string;
  model: PickCardModel;
}

/**
 * The demo's main view (issue #69): the Watchlist as the real screen lays it out, the screen
 * header, then a section eyebrow over a column of the shared `PickCard`s, so the live and hit
 * states a person sees here are the ones the real Watchlist draws. The header, the section
 * eyebrow and the spacing use the same tokens as `lineup.tsx`'s `WatchlistHeader` and `BetGroup`
 * (those are local to that 2,000-line route and tied to its data, so they are mirrored here, not
 * imported). The week card and filters are left out: they describe a real week, which the demo
 * has none of. The section reads "YOUR PICKS", the product's copy, not the real screen's "BETS".
 */
export function DemoWatchlist({ cards }: { cards: readonly DemoWatchlistCard[] }) {
  return (
    <View style={styles.screen} testID="demo-watchlist">
      <View style={styles.headerBlock}>
        <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.eyebrow}>
          DEMO
        </Text>
        <Text maxFontSizeMultiplier={theme.fontScaleCaps.title} style={styles.screenTitle}>
          Watchlist
        </Text>
      </View>
      <View style={styles.section} testID="demo-watchlist-picks">
        <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.eyebrow}>
          {`YOUR PICKS · ${cards.length}`}
        </Text>
        {cards.map((card) => (
          <PickCard key={card.id} model={card.model} />
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
  screen: {
    gap: theme.spacing.lg,
    width: '100%',
  },
  screenTitle: {
    color: theme.colors.textPrimary,
    fontFamily: fonts.sansBold,
    fontSize: theme.type.heading.size,
    fontWeight: '400',
  },
  section: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
});
