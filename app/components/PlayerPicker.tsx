import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ErrorState } from './ErrorState';
import { searchPlayers, type PlayerSearchResult } from '../lib/players';
import { theme } from '../lib/theme';

export interface PlayerPickerProps {
  roster: PlayerSearchResult[];
  onAdd: (player: PlayerSearchResult) => void;
  onRemove: (playerId: string) => void;
  onSave: () => void;
  isSaving: boolean;
  errorMessage: string | null;
  title?: string;
  subtitle?: string;
  saveLabel?: string;
}

/**
 * Shared roster builder for manual-league create (`connect-team`) and edit
 * (`edit-manual-lineup`). Search → add/remove → save; parent owns persistence.
 */
export function PlayerPicker({
  roster,
  onAdd,
  onRemove,
  onSave,
  isSaving,
  errorMessage,
  title = 'Add your players',
  subtitle = 'Search for the players on your roster.',
  saveLabel = 'Save lineup',
}: PlayerPickerProps) {
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
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>

      <TextInput
        onChangeText={onSearch}
        placeholder="Search players"
        placeholderTextColor={theme.colors.textSecondary}
        style={styles.input}
        value={query}
      />
      {isSearching ? <ActivityIndicator color={theme.colors.textPrimary} /> : null}

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
          <ActivityIndicator color={theme.colors.onAccent} />
        ) : (
          <Text style={styles.primaryButtonText}>{saveLabel}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: theme.spacing.md,
    paddingHorizontal: 20,
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderRadius: 10,
    color: theme.colors.textPrimary,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: theme.spacing.md,
  },
  leagueOption: {
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: theme.spacing.md,
  },
  leagueOptionSubtitle: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption.size,
  },
  leagueOptionTitle: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.body.size,
    fontWeight: '600',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: theme.colors.accent,
    borderRadius: 10,
    paddingVertical: 14,
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: theme.colors.onAccent,
    fontSize: 16,
    fontWeight: '700',
  },
  removeText: {
    color: theme.colors.danger,
    fontSize: theme.type.caption.size,
    fontWeight: '600',
  },
  resultsList: {
    maxHeight: 180,
  },
  rosterHeading: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: theme.spacing.sm,
    textTransform: 'uppercase',
  },
  rosterRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.sm,
  },
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    marginBottom: theme.spacing.sm,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.title.size,
    fontWeight: theme.type.title.weight,
    marginTop: theme.spacing.md,
  },
});
