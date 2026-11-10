import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';

import {
  DEMO_AWAY_TEAM,
  DEMO_HOME_TEAM,
  demoPossessionLine,
  demoTickerLine,
  type DemoLiveGame,
} from '../lib/demoGameDay';
import { theme } from '../lib/theme';
import { useReducedMotion } from '../lib/useReducedMotion';
import { TeamBadge } from './TeamBadge';

/** The LIVE dot's ring, from the approved mockup's 1.6s beat. */
const PULSE_MS = 1600;
const PULSE_START_OPACITY = 0.55;
const PULSE_END_SCALE = 2.75;
const useNativeDriver = Platform.OS !== 'web';

interface DemoLiveRowProps {
  game: DemoLiveGame;
  /** Takes the amber flare glow, as a hit pick card does (issue #65). It stays on once set. */
  glowing: boolean;
  /** The demo pick cards, rendered inside the row under the possession line. */
  children: ReactNode;
}

/**
 * Live game row of the demo game day (issue #66): pulsing LIVE dot, mono ticker, both score lines,
 * a possession line with the pylon marker, then the pick cards. Built from the same tokens the
 * Home live cards use, but not from `NowActiveCard` / `LiveStakeGameCard`, which need server wire
 * types and a watch button this local demo must not show.
 */
export function DemoLiveRow({ game, glowing, children }: DemoLiveRowProps) {
  return (
    <View
      style={[styles.row, glowing && styles.rowGlowing]}
      testID={glowing ? 'demo-live-row-glowing' : 'demo-live-row'}
    >
      <View style={styles.header}>
        <LiveDot />
        <Text
          maxFontSizeMultiplier={theme.fontScaleCaps.dense}
          numberOfLines={1}
          style={styles.ticker}
          testID="demo-live-ticker"
        >
          {demoTickerLine(game)}
        </Text>
      </View>
      <View style={styles.scores}>
        <ScoreLine abbr={DEMO_AWAY_TEAM.abbr} score={game.score.away} />
        <ScoreLine abbr={DEMO_HOME_TEAM.abbr} score={game.score.home} />
      </View>
      <View style={styles.possession}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.pylon}
          testID="demo-pylon-marker"
        />
        <Text
          maxFontSizeMultiplier={theme.fontScaleCaps.dense}
          numberOfLines={1}
          style={styles.possessionText}
          testID="demo-possession-line"
        >
          {demoPossessionLine(game)}
        </Text>
      </View>
      <View style={styles.picks}>{children}</View>
    </View>
  );
}

function ScoreLine({ abbr, score }: { abbr: string; score: number }) {
  return (
    <View style={styles.scoreLine} testID={`demo-score-${abbr}`}>
      <View style={styles.team}>
        <TeamBadge abbr={abbr} size="sm" />
        <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.abbr}>
          {abbr}
        </Text>
      </View>
      <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.score}>
        {score}
      </Text>
    </View>
  );
}

/** The flare dot with a soft ring that expands and fades. Reduce Motion: a still dot, no ring. */
function LiveDot() {
  const reduceMotion = useReducedMotion();
  const ring = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      ring.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(ring, {
        toValue: 1,
        duration: PULSE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, ring]);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.dotBox}
      testID="demo-live-dot"
    >
      {reduceMotion ? null : (
        <Animated.View
          style={[
            styles.dot,
            styles.dotRing,
            {
              opacity: ring.interpolate({
                inputRange: [0, 1],
                outputRange: [PULSE_START_OPACITY, 0],
              }),
              transform: [
                {
                  scale: ring.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, PULSE_END_SCALE],
                  }),
                },
              ],
            },
          ]}
          testID="demo-live-dot-ring"
        />
      )}
      <View style={styles.dot} />
    </View>
  );
}

const DOT_SIZE = theme.spacing.sm;

const styles = StyleSheet.create({
  abbr: {
    color: theme.colors.textPrimary,
    fontFamily: theme.type.heading.fontFamily,
    fontSize: theme.type.heading.size,
    fontWeight: theme.type.heading.weight,
  },
  dot: {
    backgroundColor: theme.colors.flare,
    borderRadius: theme.radii.pill,
    height: DOT_SIZE,
    width: DOT_SIZE,
  },
  dotBox: {
    alignItems: 'center',
    height: DOT_SIZE,
    justifyContent: 'center',
    width: DOT_SIZE,
  },
  dotRing: {
    position: 'absolute',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  picks: {
    gap: theme.spacing.md,
  },
  possession: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  possessionText: {
    color: theme.colors.textSecondary,
    flexShrink: 1,
    fontFamily: theme.type.ticker.fontFamily,
    fontSize: theme.type.ticker.size,
    fontVariant: [...theme.type.ticker.fontVariant],
    fontWeight: theme.type.ticker.weight,
    letterSpacing: theme.type.ticker.letterSpacing,
  },
  // A right-pointing triangle, drawn with borders (the possession marker in the mockup).
  pylon: {
    borderBottomColor: 'transparent',
    borderBottomWidth: theme.spacing.xs,
    borderLeftColor: theme.colors.pylon,
    borderLeftWidth: theme.spacing.sm,
    borderTopColor: 'transparent',
    borderTopWidth: theme.spacing.xs,
    height: 0,
    width: 0,
  },
  row: {
    backgroundColor: theme.colors.background,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.hero,
    borderWidth: theme.effects.panelBorderWidth,
    gap: theme.spacing.md,
    padding: theme.spacing.lg2,
    width: '100%',
  },
  rowGlowing: {
    ...theme.effects.flareGlow,
    borderColor: theme.colors.accentBorder,
  },
  score: {
    color: theme.colors.textPrimary,
    fontFamily: theme.type.score.fontFamily,
    fontSize: theme.type.score.size,
    fontVariant: [...theme.type.score.fontVariant],
    fontWeight: theme.type.score.weight,
    letterSpacing: theme.type.score.letterSpacing,
    lineHeight: theme.type.score.lineHeight,
  },
  scoreLine: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  scores: {
    gap: theme.spacing.xs,
  },
  team: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  ticker: {
    color: theme.colors.flare,
    flexShrink: 1,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontVariant: [...theme.type.ticker.fontVariant],
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
});
