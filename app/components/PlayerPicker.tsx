import { useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import { ErrorState } from './ErrorState';
import { ListRow } from './ListRow';
import { PrimaryButton } from './PrimaryButton';
import { TextButton } from './TextButton';
import { TextField } from './TextField';
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

      <TextField onChangeText={onSearch} placeholder="Search players" value={query} />
      {isSearching ? <ActivityIndicator color={theme.colors.textPrimary} /> : null}

      <FlatList
        data={results.filter((p) => !rosteredIds.has(p.player_id))}
        keyExtractor={(item) => item.player_id}
        renderItem={({ item }) => (
          <ListRow
            onPress={() => onAdd(item)}
            style={styles.resultRow}
            subtitle={`${item.position} · ${item.team?.abbreviation ?? 'FA'}`}
            title={`${item.first_name} ${item.last_name}`}
          />
        )}
        style={styles.resultsList}
      />

      <Text style={styles.rosterHeading}>Your roster ({roster.length})</Text>
      <FlatList
        data={roster}
        keyExtractor={(item) => item.player_id}
        renderItem={({ item }) => (
          <View style={styles.rosterRow}>
            <Text style={styles.rosterName}>
              {item.first_name} {item.last_name} ({item.position})
            </Text>
            <TextButton
              hitArea="slop"
              label="Remove"
              onPress={() => onRemove(item.player_id)}
              size="smallStrong"
              tone="danger"
            />
          </View>
        )}
      />

      {errorMessage ? <ErrorState message={errorMessage} /> : null}

      <PrimaryButton
        disabled={roster.length === 0}
        label={saveLabel}
        loading={isSaving}
        onPress={onSave}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg2,
  },
  resultRow: {
    marginBottom: theme.spacing.sm,
  },
  resultsList: {
    maxHeight: 180,
  },
  rosterHeading: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.eyebrow.size,
    fontFamily: theme.type.eyebrow.fontFamily,
    marginTop: theme.spacing.sm,
    textTransform: 'uppercase',
  },
  rosterName: {
    color: theme.colors.textPrimary,
    flex: 1,
    fontSize: theme.type.body.size,
    fontFamily: theme.type.button.fontFamily,
  },
  rosterRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.sm,
  },
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.small.size,
    marginBottom: theme.spacing.sm,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.title.size,
    fontFamily: theme.type.title.fontFamily,
    marginTop: theme.spacing.md,
  },
});
