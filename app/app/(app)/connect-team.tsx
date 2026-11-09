import type { FollowingOption } from '@pivot/shared/preferences';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
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
import { fetchMe, patchPreferences, FREE_MAX_MANUAL_LINEUP_SLOTS } from '../../lib/me';
import { promptUpgradeForCapError } from '../../lib/upgradePrompt';
import { theme } from '../../lib/theme';

type Mode = 'loading' | 'following' | 'choose' | 'sleeper' | 'manual';

const FOLLOWING_LABELS: Record<FollowingOption, string> = {
  fantasy: 'Fantasy team',
  bets: 'Bets & props',
  survivor: "Survivor or pick'em pools",
};

/** Order of the `following` chips (#31 step 3) — no prediction markets, not built. */
const FOLLOWING_CHOICES: FollowingOption[] = ['fantasy', 'bets', 'survivor'];

/**
 * PLAN.md Section 10 onboarding steps 3–4, updated by issue #31 (PIVOT-STAKES-PLAN.md §12.1):
 * "What are you following?" (new, onboarding only) then "Add your first picks" — also Home
 * State 5 / Settings, where the following question never shows (`onboarding` param absent).
 * `?onboarding=1` continues connect → streaming → notifications → all-set.
 * Close defers the zero-leagues gate for this session (State 5 fallback).
 */
export default function ConnectTeamScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ provider?: string; onboarding?: string }>();
  const { deferConnect, refreshLeagues } = useLeaguesGate();
  const onboarding = params.onboarding === '1';
  const [mode, setMode] = useState<Mode>(() => {
    if (params.provider === 'sleeper' || params.provider === 'manual') return params.provider;
    return onboarding ? 'loading' : 'choose';
  });
  const [following, setFollowing] = useState<FollowingOption[]>([]);

  useEffect(() => {
    if (mode !== 'loading') return;
    let cancelled = false;
    void fetchMe()
      .then((me) => {
        if (cancelled) return;
        // Existing users (already answered, or onboarding from before this shipped) skip it.
        setMode(me.preferences.following.length === 0 ? 'following' : 'choose');
      })
      .catch(() => {
        if (!cancelled) setMode('choose');
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

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

      {mode === 'loading' ? (
        <ActivityIndicator color={theme.colors.textPrimary} style={styles.loading} />
      ) : mode === 'following' ? (
        <WhatAreYouFollowing
          onContinue={async (selected) => {
            setFollowing(selected);
            setMode('choose');
            try {
              await patchPreferences({ following: selected });
            } catch {
              // Ordering preference only — the add-paths below still work unsaved this session.
            }
          }}
        />
      ) : mode === 'choose' ? (
        <ChooseProvider following={following} onChoose={setMode} />
      ) : mode === 'sleeper' ? (
        <ConnectSleeper onConnected={onConnected} />
      ) : (
        <ConnectManual onConnected={onConnected} />
      )}
    </View>
  );
}

function WhatAreYouFollowing({
  onContinue,
}: {
  onContinue: (selected: FollowingOption[]) => void | Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<FollowingOption>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  const toggle = (option: FollowingOption) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(option)) next.delete(option);
      else next.add(option);
      return next;
    });
  };

  return (
    <View style={styles.content}>
      <Text style={styles.title}>What are you following?</Text>
      <Text style={styles.subtitle}>
        We&apos;ll order the ways you add picks around what you care about.
      </Text>
      <View style={styles.grid}>
        {FOLLOWING_CHOICES.map((option) => {
          const isSelected = selected.has(option);
          return (
            <Pressable
              key={option}
              onPress={() => toggle(option)}
              style={({ pressed }) => [
                styles.block,
                isSelected && styles.blockSelected,
                pressed && styles.blockPressed,
              ]}
            >
              <Text style={[styles.blockText, isSelected && styles.blockTextSelected]}>
                {FOLLOWING_LABELS[option]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <PrimaryButton
        disabled={selected.size === 0 || isSaving}
        label="Continue"
        loading={isSaving}
        onPress={async () => {
          setIsSaving(true);
          await onContinue(FOLLOWING_CHOICES.filter((option) => selected.has(option)));
        }}
        style={styles.continue}
      />
    </View>
  );
}

function ChooseProvider({
  following,
  onChoose,
}: {
  following: FollowingOption[];
  onChoose: (mode: Mode) => void;
}) {
  const router = useRouter();

  type PathKey = 'sleeper' | 'manual' | 'pick';
  const paths: Record<PathKey, { label: string; onPress: () => void; secondary?: boolean }> = {
    sleeper: { label: 'Connect Sleeper', onPress: () => onChoose('sleeper') },
    manual: { label: 'Add manually', onPress: () => onChoose('manual'), secondary: true },
    // Always the full-screen route here — this screen is a stack sibling of the tabs, never
    // inside them, so the wide-web drawer `useOpenAddPick` opens has nothing mounted to show it.
    pick: {
      label: 'Add a pick',
      onPress: () => router.push('/(app)/add-stake'),
      secondary: true,
    },
  };

  // §12.1 order, re-ordered by the `following` selection (#31) — "Import a bet slip" stays out
  // until #12 ships and the server reports import as configured.
  const order: PathKey[] = [];
  for (const option of following) {
    if (option === 'fantasy') order.push('sleeper', 'manual');
    else order.push('pick');
  }
  for (const key of ['sleeper', 'manual', 'pick'] as const) {
    if (!order.includes(key)) order.push(key);
  }
  const seen = new Set<PathKey>();
  const orderedKeys = order.filter((key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <View style={styles.content}>
      <Text style={styles.title}>Add your first picks</Text>
      <Text style={styles.subtitle}>
        We&apos;ll watch every game you&apos;ve got riding on and tell you the moment to switch
        over.
      </Text>
      {orderedKeys.map((key) => {
        const path = paths[key];
        return path.secondary ? (
          <SecondaryButton key={key} label={path.label} onPress={path.onPress} />
        ) : (
          <PrimaryButton key={key} label={path.label} onPress={path.onPress} />
        );
      })}
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
  /** Same "larger block" variant as onboarding-streaming's service grid (UI-SPEC.md §7). */
  block: {
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderColor: 'transparent',
    borderRadius: theme.radii.lg,
    borderWidth: theme.effects.panelBorderWidth * 2,
    minWidth: '47%',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.xl,
  },
  blockPressed: {
    backgroundColor: theme.colors.surfaceRaised,
  },
  blockSelected: {
    borderColor: theme.colors.accentBorder,
  },
  blockText: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.smallStrong.size,
    fontWeight: theme.type.smallStrong.weight,
  },
  blockTextSelected: {
    color: theme.colors.textPrimary,
  },
  content: {
    flex: 1,
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg2,
  },
  continue: {
    marginTop: theme.spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.md,
  },
  header: {
    paddingHorizontal: theme.spacing.lg2,
  },
  leagueRow: {
    marginBottom: theme.spacing.sm,
  },
  loading: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
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
