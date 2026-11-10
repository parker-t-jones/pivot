import { StyleSheet, Text, View } from 'react-native';

import type { ShareContent } from '../lib/shareCard';
import { theme } from '../lib/theme';
import { Slip } from './Slip';

interface ShareableCardProps {
  content: ShareContent;
}

/**
 * Static, branded render of a week card or pick card for image export (issue #48). This is
 * what the capture actually sees — never the live interactive card, so no buttons or chrome,
 * `theme.ts` tokens only, same as the rest of the app.
 */
export function ShareableCard({ content }: ShareableCardProps) {
  return (
    <View style={styles.frame} testID="shareable-card">
      <Slip style={styles.slip}>
        <Text
          maxFontSizeMultiplier={theme.fontScaleCaps.dense}
          numberOfLines={2}
          style={styles.title}
        >
          {content.title}
        </Text>
        {content.subtitle ? (
          <Text
            maxFontSizeMultiplier={theme.fontScaleCaps.dense}
            numberOfLines={1}
            style={styles.subtitle}
          >
            {content.subtitle}
          </Text>
        ) : null}
        <View style={styles.rows}>
          {content.rows.map((row, index) => (
            <View key={`${row.label}-${index}`} style={styles.row}>
              <Text
                maxFontSizeMultiplier={theme.fontScaleCaps.dense}
                numberOfLines={1}
                style={styles.rowLabel}
              >
                {row.label}
              </Text>
              <Text
                maxFontSizeMultiplier={theme.fontScaleCaps.dense}
                numberOfLines={2}
                style={styles.rowValue}
              >
                {row.value}
              </Text>
              {row.note ? (
                <Text
                  maxFontSizeMultiplier={theme.fontScaleCaps.dense}
                  numberOfLines={1}
                  style={styles.rowNote}
                >
                  {row.note}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
        <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.footer}>
          {content.footer}
        </Text>
      </Slip>
    </View>
  );
}

const CARD_WIDTH = 360;

const styles = StyleSheet.create({
  footer: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    paddingBottom: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    textAlign: 'center',
  },
  frame: {
    backgroundColor: theme.colors.background,
    padding: theme.spacing.xl,
    width: CARD_WIDTH + theme.spacing.xl * 2,
  },
  row: {
    gap: theme.spacing.xs,
    width: '50%',
  },
  rowLabel: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    textTransform: 'uppercase',
  },
  rowNote: {
    color: theme.colors.accent,
    fontSize: theme.type.caption.size,
  },
  rows: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingTop: theme.spacing.lg,
    rowGap: theme.spacing.md,
  },
  rowValue: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.bodyStrong.size,
    fontWeight: theme.type.bodyStrong.weight,
  },
  slip: {
    overflow: 'visible',
  },
  subtitle: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xs,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.heading.size,
    fontWeight: theme.type.heading.weight,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
  },
});
