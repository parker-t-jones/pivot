import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ErrorState } from '../../components/ErrorState';
import { ApiRequestError } from '../../lib/apiClient';
import {
  connectManualLeague,
  connectSleeperLeague,
  fetchLineup,
  fetchSleeperLeagues,
  type SleeperLeagueOption,
} from '../../lib/leagues';
import { searchPlayers, type PlayerSearchResult } from '../../lib/players';
import { apiClient } from '../../lib/apiClient';

type Mode = 'choose' | 'sleeper' | 'manual';

/**
 * PLAN.md Section 10 onboarding step 3 ("Connect fantasy team") — doubles as Home State 5's "get
 * started" destination (Sprint 9 Phase 2: see report on why these are the same screen rather than
 * two near-identical UIs). `?provider=sleeper|manual` preselects a path (Home's two State 5 buttons
 * link straight in); `?onboarding=1` (set only by the sign-up flow) continues to the streaming-
 * services/all-set steps on success instead of just returning to Home.
 */
export default function ConnectTeamScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ provider?: string; onboarding?: string }>();
  const [mode, setMode] = useState<Mode>(
    params.provider === 'sleeper' || params.provider === 'manual' ? params.provider : 'choose',
  );

  const onConnected = () => {
    if (params.onboarding === '1') {
      router.replace('/(app)/onboarding-streaming');
    } else {
      router.replace('/(app)');
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()}>
          <Text style={styles.backText}>Close</Text>
        </Pressable>
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
      <Pressable onPress={() => onChoose('sleeper')} style={styles.primaryButton}>
        <Text style={styles.primaryButtonText}>Connect Sleeper</Text>
      </Pressable>
      <Pressable onPress={() => onChoose('manual')} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>Add manually</Text>
      </Pressable>
    </View>
  );
}

function ConnectSleeper({ onConnected }: { onConnected: () => void }) {
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
        setErrorMessage('No leagues found for that Sleeper username.');
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
      onConnected();
    } catch (error) {
      setErrorMessage(error instanceof ApiRequestError ? error.message : 'Could not connect league.');
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

      <TextInput
        autoCapitalize="none"
        onChangeText={setUsername}
        placeholder="Sleeper username"
        placeholderTextColor="#8e8e93"
        style={styles.input}
        value={username}
      />

      <Pressable disabled={isSearching} onPress={onFindLeagues} style={styles.primaryButton}>
        {isSearching ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryButtonText}>Find leagues</Text>
        )}
      </Pressable>

      {errorMessage ? <ErrorState message={errorMessage} /> : null}

      {leagues ? (
        <FlatList
          data={leagues}
          keyExtractor={(item) => item.league_id}
          renderItem={({ item }) => (
            <Pressable
              disabled={connectingLeagueId !== null}
              onPress={() => onSelectLeague(item)}
              style={styles.leagueOption}
            >
              <View>
                <Text style={styles.leagueOptionTitle}>{item.name}</Text>
                <Text style={styles.leagueOptionSubtitle}>{item.season} season</Text>
              </View>
              {connectingLeagueId === item.league_id ? <ActivityIndicator color="#fff" /> : null}
            </Pressable>
          )}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

function ConnectManual({ onConnected }: { onConnected: () => void }) {
  const [name, setName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [league, setLeague] = useState<{ league_id: string; week: number } | null>(null);
  const [roster, setRoster] = useState<PlayerSearchResult[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const onCreateLeague = async () => {
    if (name.trim().length === 0) return;
    setIsCreating(true);
    setErrorMessage(null);
    try {
      const created = await connectManualLeague(name.trim(), new Date().getFullYear());
      const lineup = await fetchLineup(created.league_id);
      setLeague({ league_id: created.league_id, week: lineup.week });
    } catch (error) {
      setErrorMessage(error instanceof ApiRequestError ? error.message : 'Could not create league.');
    } finally {
      setIsCreating(false);
    }
  };

  const onSaveLineup = async () => {
    if (!league) return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      await apiClient.put(`/leagues/${league.league_id}/lineup`, {
        week: league.week,
        slots: roster.map((player) => ({
          player_id: player.player_id,
          slot_type: 'starter',
          position_in_lineup: player.position,
        })),
      });
      onConnected();
    } catch (error) {
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
        <TextInput
          onChangeText={setName}
          placeholder="League name"
          placeholderTextColor="#8e8e93"
          style={styles.input}
          value={name}
        />
        <Pressable disabled={isCreating} onPress={onCreateLeague} style={styles.primaryButton}>
          {isCreating ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>Continue</Text>
          )}
        </Pressable>
        {errorMessage ? <ErrorState message={errorMessage} /> : null}
      </KeyboardAvoidingView>
    );
  }

  return (
    <PlayerPicker
      roster={roster}
      onAdd={(player) => setRoster((current) => [...current, player])}
      onRemove={(playerId) =>
        setRoster((current) => current.filter((p) => p.player_id !== playerId))
      }
      onSave={onSaveLineup}
      isSaving={isSaving}
      errorMessage={errorMessage}
    />
  );
}

function PlayerPicker({
  roster,
  onAdd,
  onRemove,
  onSave,
  isSaving,
  errorMessage,
}: {
  roster: PlayerSearchResult[];
  onAdd: (player: PlayerSearchResult) => void;
  onRemove: (playerId: string) => void;
  onSave: () => void;
  isSaving: boolean;
  errorMessage: string | null;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlayerSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const rosteredIds = new Set(roster.map((p) => p.player_id));

  const onSearch = async (text: string) => {
    setQuery(text);
    if (text.trim().length < 2) {
      setResults([]);
      return;
    }
    setIsSearching(true);
    try {
      setResults(await searchPlayers(text));
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <View style={styles.content}>
      <Text style={styles.title}>Add your players</Text>
      <Text style={styles.subtitle}>Search for the players on your roster.</Text>

      <TextInput
        onChangeText={onSearch}
        placeholder="Search players"
        placeholderTextColor="#8e8e93"
        style={styles.input}
        value={query}
      />
      {isSearching ? <ActivityIndicator color="#fff" /> : null}

      <FlatList
        data={results.filter((p) => !rosteredIds.has(p.player_id))}
        keyExtractor={(item) => item.player_id}
        renderItem={({ item }) => (
          <Pressable onPress={() => onAdd(item)} style={styles.leagueOption}>
            <Text style={styles.leagueOptionTitle}>
              {item.first_name} {item.last_name}
            </Text>
            <Text style={styles.leagueOptionSubtitle}>
              {item.position} · {item.team?.abbreviation ?? 'FA'}
            </Text>
          </Pressable>
        )}
        style={styles.resultsList}
      />

      <Text style={styles.rosterHeading}>Your roster ({roster.length})</Text>
      <FlatList
        data={roster}
        keyExtractor={(item) => item.player_id}
        renderItem={({ item }) => (
          <View style={styles.rosterRow}>
            <Text style={styles.leagueOptionTitle}>
              {item.first_name} {item.last_name} ({item.position})
            </Text>
            <Pressable onPress={() => onRemove(item.player_id)}>
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
          </View>
        )}
      />

      {errorMessage ? <ErrorState message={errorMessage} /> : null}

      <Pressable
        disabled={isSaving || roster.length === 0}
        onPress={onSave}
        style={[styles.primaryButton, roster.length === 0 && styles.primaryButtonDisabled]}
      >
        {isSaving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryButtonText}>Save lineup</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backText: {
    color: '#5aa2ff',
    fontSize: 16,
  },
  content: {
    flex: 1,
    gap: 12,
    paddingHorizontal: 20,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  input: {
    backgroundColor: '#1c1c1e',
    borderRadius: 10,
    color: '#fff',
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  leagueOption: {
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  leagueOptionSubtitle: {
    color: '#8e8e93',
    fontSize: 13,
  },
  leagueOptionTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#1f6feb',
    borderRadius: 10,
    paddingVertical: 14,
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  removeText: {
    color: '#ff6b6b',
    fontSize: 13,
    fontWeight: '600',
  },
  resultsList: {
    maxHeight: 180,
  },
  rosterHeading: {
    color: '#8e8e93',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
    textTransform: 'uppercase',
  },
  rosterRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  screen: {
    backgroundColor: '#000',
    flex: 1,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    borderRadius: 10,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  subtitle: {
    color: '#8e8e93',
    fontSize: 14,
    marginBottom: 8,
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    marginTop: 12,
  },
});
