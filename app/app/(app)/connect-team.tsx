import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState } from '../../components/ErrorState';
import { ListRow } from '../../components/ListRow';
import { PlayerPicker } from '../../components/PlayerPicker';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { TextButton } from '../../components/TextButton';
import { TextField } from '../../components/TextField';
import { useLeaguesGate } from '../../contexts/LeaguesGateContext';
import { useUpgradeSheet } from '../../contexts/UpgradeSheetContext';
import { ApiRequestError } from '../../lib/apiClient';
import {
  connectManualLeague,
  connectSleeperLeague,
  fetchLineup,
  fetchSleeperLeagues,
  putManualLineup,
  type SleeperLeagueOption,
} from '../../lib/leagues';
import { navigateAfterConnect } from '../../lib/navigateAfterConnect';
import type { PlayerSearchResult } from '../../lib/players';
import { fetchMe, FREE_MAX_MANUAL_LINEUP_SLOTS } from '../../lib/me';
import { promptUpgradeForCapError } from '../../lib/upgradePrompt';
import { theme } from '../../lib/theme';

type Mode = 'choose' | 'sleeper' | 'manual';

/**
 * PLAN.md Section 10 onboarding step 3 ("Connect fantasy team") — also Home State 5 / Settings.
 * `?onboarding=1` continues connect → streaming → notifications → all-set.
 * Close defers the zero-leagues gate for this session (State 5 fallback).
 */
export default function ConnectTeamScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ provider?: string; onboarding?: string }>();
  const { deferConnect, refreshLeagues } = useLeaguesGate();
  const [mode, setMode] = useState<Mode>(
    params.provider === 'sleeper' || params.provider === 'manual' ? params.provider : 'choose',
  );

  const onboarding = params.onboarding === '1';

  const onConnected = async () => {
    // Await server list before navigate — no optimistic count bump (avoids count/list divergence).
    await refreshLeagues();
    navigateAfterConnect(router, { onboarding });
  };

  const onClose = () => {
    // Session flag is set synchronously before navigate — see connectDeferredSession.ts (Bug 1).
    deferConnect();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(app)');
    }
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + theme.spacing.lg }]}>
        <TextButton label="Close" onPress={onClose} />
      </View>

      {mode === 'choose' ? (
        <ChooseProvider onChoose={setMode} />
      ) : mode === 'sleeper' ? (
        <ConnectSleeper onConnected={onConnected} />
      ) : (
        <ConnectManual onConnected={onConnected} />
      )}
    </View>
  );
}

function ChooseProvider({ onChoose }: { onChoose: (mode: Mode) => void }) {
  return (
    <View style={styles.content}>
      <Text style={styles.title}>Connect your fantasy team</Text>
      <Text style={styles.subtitle}>
        We&apos;ll watch every game your players are in and tell you the moment to switch over.
      </Text>
      <PrimaryButton label="Connect Sleeper" onPress={() => onChoose('sleeper')} />
      <SecondaryButton label="Add manually" onPress={() => onChoose('manual')} />
    </View>
  );
}

function ConnectSleeper({ onConnected }: { onConnected: () => void | Promise<void> }) {
  const { openUpgrade } = useUpgradeSheet();
  const [username, setUsername] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [leagues, setLeagues] = useState<SleeperLeagueOption[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [connectingLeagueId, setConnectingLeagueId] = useState<string | null>(null);

  const onFindLeagues = async () => {
    if (username.trim().length === 0) return;
    setIsSearching(true);
    setErrorMessage(null);
    try {
      const result = await fetchSleeperLeagues(username.trim());
      setLeagues(result);
      if (result.length === 0) {
        setErrorMessage(
          'We found your Sleeper account, but it has no leagues yet for the upcoming season. ' +
            'Leagues usually appear once your commissioner renews them before the draft.',
        );
      }
    } catch (error) {
      setErrorMessage(error instanceof ApiRequestError ? error.message : 'Could not find leagues.');
    } finally {
      setIsSearching(false);
    }
  };

  const onSelectLeague = async (league: SleeperLeagueOption) => {
    setConnectingLeagueId(league.league_id);
    setErrorMessage(null);
    try {
      await connectSleeperLeague(username.trim(), league.league_id);
      await onConnected();
    } catch (error) {
      if (promptUpgradeForCapError(error, openUpgrade)) {
        setConnectingLeagueId(null);
        return;
      }
      setErrorMessage(
        error instanceof ApiRequestError ? error.message : 'Could not connect league.',
      );
      setConnectingLeagueId(null);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: 'padding', default: undefined })}
      style={styles.content}
    >
      <Text style={styles.title}>Connect Sleeper</Text>
      <Text style={styles.subtitle}>Enter your Sleeper username to find your leagues.</Text>

      <TextField
        autoCapitalize="none"
        onChangeText={setUsername}
        placeholder="Sleeper username"
        value={username}
      />

      <PrimaryButton label="Find leagues" loading={isSearching} onPress={onFindLeagues} />

      {errorMessage ? <ErrorState message={errorMessage} /> : null}

      {leagues ? (
        <FlatList
          data={leagues}
          keyExtractor={(item) => item.league_id}
          renderItem={({ item }) => (
            <ListRow
              disabled={connectingLeagueId !== null}
              onPress={() => onSelectLeague(item)}
              style={styles.leagueRow}
              subtitle={`${item.season} season`}
              title={item.name}
              trailing={
                connectingLeagueId === item.league_id ? (
                  <ActivityIndicator color={theme.colors.textPrimary} />
                ) : null
              }
            />
          )}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

function ConnectManual({ onConnected }: { onConnected: () => void | Promise<void> }) {
  const { openUpgrade } = useUpgradeSheet();
  const [name, setName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [league, setLeague] = useState<{ league_id: string; week: number } | null>(null);
  const [roster, setRoster] = useState<PlayerSearchResult[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [freeCap, setFreeCap] = useState<number | undefined>(FREE_MAX_MANUAL_LINEUP_SLOTS);

  useEffect(() => {
    void fetchMe()
      .then((me) => {
        setFreeCap(me.subscription_tier === 'pro' ? undefined : FREE_MAX_MANUAL_LINEUP_SLOTS);
      })
      .catch(() => {
        setFreeCap(FREE_MAX_MANUAL_LINEUP_SLOTS);
      });
  }, []);

  const onCreateLeague = async () => {
    if (name.trim().length === 0) return;
    setIsCreating(true);
    setErrorMessage(null);
    try {
      const created = await connectManualLeague(name.trim(), new Date().getFullYear());
      const lineup = await fetchLineup(created.league_id);
      setLeague({ league_id: created.league_id, week: lineup.week });
    } catch (error) {
      if (promptUpgradeForCapError(error, openUpgrade)) {
        return;
      }
      setErrorMessage(
        error instanceof ApiRequestError ? error.message : 'Could not create league.',
      );
    } finally {
      setIsCreating(false);
    }
  };

  const onSaveLineup = async () => {
    if (!league) return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      await putManualLineup(league.league_id, league.week, roster);
      await onConnected();
    } catch (error) {
      if (promptUpgradeForCapError(error, openUpgrade)) {
        return;
      }
      setErrorMessage(error instanceof ApiRequestError ? error.message : 'Could not save lineup.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!league) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: 'padding', default: undefined })}
        style={styles.content}
      >
        <Text style={styles.title}>Add your team manually</Text>
        <Text style={styles.subtitle}>Name your league — you&apos;ll add players next.</Text>
        <TextField onChangeText={setName} placeholder="League name" value={name} />
        <PrimaryButton label="Continue" loading={isCreating} onPress={onCreateLeague} />
        {errorMessage ? <ErrorState message={errorMessage} /> : null}
      </KeyboardAvoidingView>
    );
  }

  return (
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
      onSave={onSaveLineup}
      isSaving={isSaving}
      errorMessage={errorMessage}
      maxRosterSize={freeCap}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg2,
  },
  header: {
    paddingHorizontal: theme.spacing.lg2,
  },
  leagueRow: {
    marginBottom: theme.spacing.sm,
  },
  screen: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.small.size,
    marginBottom: theme.spacing.sm,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.title.size,
    fontWeight: theme.type.title.weight,
    marginTop: theme.spacing.md,
  },
});
