import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { HomeSegmentRow } from '../../components/HomeSegmentRow';
import { ListRow } from '../../components/ListRow';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { Slip } from '../../components/Slip';
import { TeamBadge } from '../../components/TeamBadge';
import { TextButton } from '../../components/TextButton';
import { theme } from '../../lib/theme';
import { TOUR_CARDS, tourHasNextCard } from '../../lib/tourCards';

/**
 * Onboarding step 7 (issue #32 / PIVOT-STAKES-PLAN.md §12.1 item 7, §12.2): the four tutorial
 * cards in a `Slip`, skippable. Also reachable any time from Settings → Help → "Replay tour"
 * (no `onboarding` param, so the end actions go back to Settings instead of all-set/Home).
 */
export default function OnboardingTourScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ onboarding?: string }>();
  const isOnboarding = params.onboarding === '1';
  const [index, setIndex] = useState(0);

  const finish = () => {
    if (isOnboarding) {
      router.replace('/(app)/onboarding-all-set');
    } else {
      router.back();
    }
  };

  const tryDemo = () => {
    router.replace('/(app)/demo-game-day');
  };

  const card = TOUR_CARDS[index];
  if (!card) return null;
  const hasNext = tourHasNextCard(index);

  return (
    <View style={styles.container}>
      <Slip style={styles.card}>
        <Text style={styles.eyebrow}>{card.eyebrow}</Text>
        <CardIllustration cardId={card.id} />
        <Text style={styles.title}>{card.title}</Text>
        <Text style={styles.body}>{card.body}</Text>

        {hasNext ? (
          <PrimaryButton
            label="Next"
            onPress={() => setIndex(index + 1)}
            style={styles.primaryAction}
          />
        ) : (
          <>
            <PrimaryButton
              label="Try a demo game day"
              onPress={tryDemo}
              style={styles.primaryAction}
            />
            <SecondaryButton label="Go to Home" onPress={finish} style={styles.secondaryAction} />
          </>
        )}

        <TextButton label="Skip" onPress={finish} size="small" style={styles.skip} tone="muted" />
      </Slip>
    </View>
  );
}

/** Small static illustration per card, built from the real components each describes. */
function CardIllustration({ cardId }: { cardId: string }) {
  switch (cardId) {
    case 'board':
      return (
        <View style={styles.illustration}>
          <HomeSegmentRow segment="board" onChange={() => undefined} />
          <View style={styles.badgeRow}>
            <TeamBadge abbr="KC" size="sm" />
            <TeamBadge abbr="BUF" size="sm" />
            <TeamBadge abbr="DAL" size="sm" />
          </View>
        </View>
      );
    case 'live':
      return (
        <View style={styles.illustration}>
          <Text style={styles.liveEyebrow}>LIVE</Text>
          <View style={styles.badgeRow}>
            <TeamBadge abbr="KC" size="md" />
            <Text style={styles.vs}>vs</Text>
            <TeamBadge abbr="LV" size="md" />
          </View>
        </View>
      );
    case 'alerts':
      return (
        <View style={styles.illustration}>
          <ListRow subtitle="Switch before the drive starts" title="Your QB just took the field" />
        </View>
      );
    case 'watchlist':
      return (
        <View style={styles.illustration}>
          <ListRow subtitle="Chiefs -3.5" title="Week 10" />
          <ListRow subtitle="Bills / Dolphins O48.5" title="Totals" />
          <ListRow subtitle="3 legs" title="Parlay" />
        </View>
      );
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  badgeRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  body: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
    fontWeight: theme.type.body.weight,
    lineHeight: theme.type.body.lineHeight,
  },
  card: {
    gap: theme.spacing.md2,
    maxWidth: 420,
    padding: theme.spacing.lg2,
    width: '100%',
  },
  container: {
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
  },
  eyebrow: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    textTransform: 'uppercase',
  },
  illustration: {
    gap: theme.spacing.sm,
    marginVertical: theme.spacing.sm,
  },
  liveEyebrow: {
    color: theme.colors.accent,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  primaryAction: {
    marginTop: theme.spacing.md,
  },
  secondaryAction: {
    marginTop: theme.spacing.sm,
  },
  skip: {
    alignSelf: 'center',
    marginTop: theme.spacing.sm,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.title.size,
    fontWeight: theme.type.title.weight,
  },
  vs: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.body.size,
  },
});
