import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { RecapWeekCard } from '../../components/RecapWeekCard';
import { Skeleton, SkeletonGroup } from '../../components/Skeleton';
import { TextButton } from '../../components/TextButton';
import { ApiRequestError } from '../../lib/apiClient';
import { fetchRecap } from '../../lib/picksClient';
import { recapHistoryModel, type RecapHistoryModel } from '../../lib/recapHistory';
import { theme } from '../../lib/theme';

/**
 * Recap (issue #47): season-to-date hit rate, then every past week with a graded pick, most
 * recent first. Each week expands in place (same pattern as the Watchlist's fantasy league cards)
 * to its best and worst pick and every pick that week with its result. Reached from Settings →
 * Help → "Your recap" — a Settings entry rather than a Home segment or tab, since it's a
 * look-back, not something that needs a permanent slot in the primary nav.
 */
export default function RecapScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [model, setModel] = useState<RecapHistoryModel | null>(null);
  // Weeks the user has toggled away from their default (the most recent week starts open).
  const [toggledWeeks, setToggledWeeks] = useState<ReadonlySet<number>>(() => new Set());

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setModel(recapHistoryModel(await fetchRecap()));
    } catch (error) {
      setLoadError(error instanceof ApiRequestError ? error.message : 'Could not load recap.');
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    void load().finally(() => setIsLoading(false));
  }, [load]);

  const toggleWeek = useCallback((week: number) => {
    setToggledWeeks((current) => {
      const next = new Set(current);
      if (next.has(week)) next.delete(week);
      else next.add(week);
      return next;
    });
  }, []);

  const mostRecentWeek = model?.weeks[0]?.week ?? null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.huge,
        },
      ]}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Recap</Text>
        <TextButton label="Close" onPress={() => router.back()} size="small" />
      </View>
      {isLoading ? (
        <RecapSkeleton />
      ) : loadError || !model ? (
        <ErrorState
          message={loadError ?? 'Could not load recap.'}
          onRetry={() => {
            void load();
          }}
        />
      ) : model.isEmpty ? (
        <EmptyState
          title="Nothing graded yet"
          message="Add a pick before kickoff. Once the games are final, your week shows up right here."
        />
      ) : (
        <>
          <View style={styles.seasonCard} testID="recap-season">
            <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.eyebrow}>
              THIS SEASON
            </Text>
            <Text style={styles.seasonLine} testID="recap-season-line">
              {model.seasonLine}
            </Text>
          </View>
          {model.weeks.map((week) => {
            const openByDefault = week.week === mostRecentWeek;
            const expanded = toggledWeeks.has(week.week) ? !openByDefault : openByDefault;
            return (
              <RecapWeekCard
                expanded={expanded}
                key={week.week}
                model={week}
                onToggle={() => toggleWeek(week.week)}
              />
            );
          })}
        </>
      )}
    </ScrollView>
  );
}

/** Season card plus two collapsed week cards: the shape most accounts load into. */
function RecapSkeleton() {
  return (
    <View testID="recap-loading">
      <SkeletonGroup>
        <View style={styles.stack}>
          <Skeleton style={styles.seasonBlock} />
          <Skeleton style={styles.weekBlock} />
          <Skeleton style={styles.weekBlock} />
        </View>
      </SkeletonGroup>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg2,
  },
  eyebrow: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerTitle: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.heading.size,
    fontWeight: theme.type.heading.weight,
  },
  screen: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  // Season card: lg padding, eyebrow + xs gap + heading line, border.
  seasonBlock: {
    height:
      theme.spacing.lg * 2 +
      theme.type.caption.lineHeight +
      theme.spacing.xs +
      theme.type.heading.lineHeight +
      theme.effects.panelBorderWidth * 2,
  },
  seasonCard: {
    backgroundColor: theme.colors.background,
    borderColor: theme.colors.accentBorder,
    borderRadius: theme.radii.lg,
    borderWidth: theme.effects.panelBorderWidth,
    gap: theme.spacing.xs,
    padding: theme.spacing.lg,
    ...theme.effects.panelGlow,
  },
  seasonLine: {
    color: theme.colors.textPrimary,
    fontFamily: theme.type.heading.fontFamily,
    fontSize: theme.type.heading.size,
    fontWeight: theme.type.heading.weight,
    lineHeight: theme.type.heading.lineHeight,
  },
  stack: {
    gap: theme.spacing.lg,
  },
  // Collapsed RecapWeekCard: same box as the season card.
  weekBlock: {
    height:
      theme.spacing.lg * 2 +
      theme.type.caption.lineHeight +
      theme.spacing.xs +
      theme.type.heading.lineHeight +
      theme.effects.panelBorderWidth * 2,
  },
});
