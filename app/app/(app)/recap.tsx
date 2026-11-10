import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import { RecapCard } from '../../components/RecapCard';
import { TextButton } from '../../components/TextButton';
import { ApiRequestError } from '../../lib/apiClient';
import { fetchRecap, type RecapPage } from '../../lib/picksClient';
import { recapCardModel } from '../../lib/recapCard';
import { theme } from '../../lib/theme';

/**
 * Recap (issue #47): per-week picks made, hit rate, and best/worst graded pick, plus
 * season-to-date hit rate. Reached from Settings → Help → "This week's recap" — a Settings entry
 * rather than a Home segment or tab, since it's a once-a-week look-back, not something that needs
 * a permanent slot in the primary nav the way Home and Lineup do.
 */
export default function RecapScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState<RecapPage | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setPage(await fetchRecap());
    } catch (error) {
      setLoadError(error instanceof ApiRequestError ? error.message : 'Could not load recap.');
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    void load().finally(() => setIsLoading(false));
  }, [load]);

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
        {Platform.OS === 'web' ? (
          <TextButton label="Close" onPress={() => router.back()} size="small" />
        ) : null}
      </View>
      {isLoading ? (
        <LoadingState message="Loading your recap…" />
      ) : loadError || !page ? (
        <ErrorState
          message={loadError ?? 'Could not load recap.'}
          onRetry={() => {
            void load();
          }}
        />
      ) : (
        <RecapCard model={recapCardModel(page)} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: theme.spacing.lg2,
    paddingHorizontal: theme.spacing.lg2,
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
});
