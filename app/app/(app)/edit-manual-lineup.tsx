import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import { PlayerPicker } from '../../components/PlayerPicker';
import { TextButton } from '../../components/TextButton';
import { useLeaguesGate } from '../../contexts/LeaguesGateContext';
import { useUpgradeSheet } from '../../contexts/UpgradeSheetContext';
import { ApiRequestError } from '../../lib/apiClient';
import { fetchLineup, putManualLineup } from '../../lib/leagues';
import {
  fetchMe,
  FREE_MAX_MANUAL_LINEUP_SLOTS,
  type MeResponse,
} from '../../lib/me';
import type { PlayerSearchResult } from '../../lib/players';
import { promptUpgradeForCapError } from '../../lib/upgradePrompt';
import { theme } from '../../lib/theme';

/**
 * Settings → manual league → Edit lineup. Loads existing slots via GET lineup,
 * saves via PUT — no POST /leagues/manual (create stays on connect-team).
 */
export default function EditManualLineupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ leagueId?: string }>();
  const leagueId = typeof params.leagueId === 'string' ? params.leagueId : null;
  const { leagues, refreshLeagues } = useLeaguesGate();
  const { openUpgrade } = useUpgradeSheet();

  const [week, setWeek] = useState<number | null>(null);
  const [roster, setRoster] = useState<PlayerSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);

  const league = leagues.find((row) => row.league_id === leagueId) ?? null;
  const freeCap =
    me && me.subscription_tier !== 'pro' ? FREE_MAX_MANUAL_LINEUP_SLOTS : undefined;

  const load = useCallback(async () => {
    if (!leagueId) {
      setErrorMessage('Missing league id.');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      // Prefer gate list; if Settings opened before refresh, re-fetch list for platform check.
      let platform = league?.platform;
      if (!platform) {
        const rows = await refreshLeagues();
        platform = rows.find((row) => row.league_id === leagueId)?.platform;
      }
      if (platform !== 'manual') {
        setErrorMessage('Only manual leagues can edit lineup here.');
        setIsLoading(false);
        return;
      }

      const [lineup, meResponse] = await Promise.all([fetchLineup(leagueId), fetchMe()]);
      setMe(meResponse);
      setWeek(lineup.week);
      setRoster(
        lineup.slots.map((slot) => ({
          player_id: slot.player.player_id,
          first_name: slot.player.first_name,
          last_name: slot.player.last_name,
          position: slot.player.position,
          team: slot.player.team,
        })),
      );
    } catch (error) {
      setErrorMessage(error instanceof ApiRequestError ? error.message : 'Could not load lineup.');
    } finally {
      setIsLoading(false);
    }
  }, [league?.platform, leagueId, refreshLeagues]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSave = async () => {
    if (!leagueId || week == null) return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      await putManualLineup(leagueId, week, roster);
      await refreshLeagues();
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/(app)/(tabs)/lineup');
      }
    } catch (error) {
      if (promptUpgradeForCapError(error, openUpgrade)) {
        return;
      }
      setErrorMessage(error instanceof ApiRequestError ? error.message : 'Could not save lineup.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + theme.spacing.lg }]}>
        <TextButton
          label="Back"
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/(app)/(tabs)/lineup');
          }}
        />
        {league ? <Text style={styles.headerTitle}>{league.name}</Text> : null}
      </View>

      {isLoading ? (
        <LoadingState message="Loading lineup…" />
      ) : errorMessage && week == null ? (
        <ErrorState message={errorMessage} onRetry={() => void load()} />
      ) : week == null ? (
        <ErrorState
          message={errorMessage ?? 'Could not load lineup.'}
          onRetry={() => void load()}
        />
      ) : (
        <PlayerPicker
          roster={roster}
          onAdd={(player) => {
            if (freeCap != null && roster.length >= freeCap) {
              promptUpgradeForCapError(
                new ApiRequestError(
                  403,
                  'manual_lineup_limit_free',
                  `Free accounts can add up to ${freeCap} players. Upgrade to Pro for unlimited.`,
                ),
                openUpgrade,
              );
              return;
            }
            setRoster((current) => [...current, player]);
          }}
          onRemove={(playerId) =>
            setRoster((current) => current.filter((p) => p.player_id !== playerId))
          }
          onSave={onSave}
          isSaving={isSaving}
          errorMessage={errorMessage}
          title="Edit your lineup"
          subtitle="Add or remove players, then save."
          maxRosterSize={freeCap}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg2,
    paddingBottom: theme.spacing.md,
  },
  headerTitle: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption.size,
  },
  screen: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
});
