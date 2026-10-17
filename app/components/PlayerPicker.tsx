import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ErrorState } from './ErrorState';
import { ListRow } from './ListRow';
import { PrimaryButton } from './PrimaryButton';
import { TextButton } from './TextButton';
import { TextField } from './TextField';
import { TEXT_BUTTON_HIT_SLOP } from '../lib/controlRecipes';
import { queryAfterSearchReset, searchClearVisible } from '../lib/playerSearch';
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
  /** When set, shown in the roster heading (free-tier hint). */
  maxRosterSize?: number;
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
  maxRosterSize,
}: PlayerPickerProps) {
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlayerSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const rosteredIds = new Set(roster.map((p) => p.player_id));

  const resetQuery = () => {
    setQuery(queryAfterSearchReset());
    setResults([]);
    inputRef.current?.focus();
  };

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

  const rosterHeading =
    maxRosterSize != null
      ? `Your roster (${roster.length}/${maxRosterSize})`
      : `Your roster (${roster.length})`;

  return (
    <View style={styles.content}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>

      <TextField
        blurOnSubmit={false}
        onChangeText={onSearch}
        onSubmitEditing={() => {
          inputRef.current?.focus();
        }}
        placeholder="Search players"
        ref={inputRef}
        returnKeyType="search"
        trailing={
          <View pointerEvents="box-none" style={styles.clearSlot}>
            {searchClearVisible(query) ? (
              <Pressable
                accessibilityLabel="Clear search"
                accessibilityRole="button"
                hitSlop={TEXT_BUTTON_HIT_SLOP}
                onPress={resetQuery}
                style={styles.clearHit}
                {...webKeepFocus}
              >
                <Text style={styles.clearMark}>×</Text>
              </Pressable>
            ) : null}
          </View>
        }
        value={query}
      />
      {isSearching ? <ActivityIndicator color={theme.colors.textPrimary} /> : null}

      <FlatList
        data={results.filter((p) => !rosteredIds.has(p.player_id))}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => item.player_id}
        renderItem={({ item }) => (
          <ListRow
            onPress={() => {
              onAdd(item);
              resetQuery();
            }}
            style={styles.resultRow}
            subtitle={`${item.position} · ${item.team?.abbreviation ?? 'FA'}`}
            title={`${item.first_name} ${item.last_name}`}
          />
        )}
        style={styles.resultsList}
      />

      <Text style={styles.rosterHeading}>{rosterHeading}</Text>
      <FlatList
        data={roster}
        keyboardShouldPersistTaps="handled"
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

/**
 * Web blurs an input on mousedown of another control. Cancelling that keeps the
 * caret in the field when the clear button is pressed. Native has no mouse event.
 */
const webKeepFocus =
  Platform.OS === 'web'
    ? {
        onMouseDown: (event: { preventDefault: () => void }) => {
          event.preventDefault();
        },
      }
    : {};

const styles = StyleSheet.create({
  clearHit: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
  },
  clearMark: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.button.size,
    fontWeight: theme.type.button.weight,
  },
  clearSlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
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
    fontWeight: theme.type.eyebrow.weight,
    marginTop: theme.spacing.sm,
    textTransform: 'uppercase',
  },
  rosterName: {
    color: theme.colors.textPrimary,
    flex: 1,
    fontSize: theme.type.body.size,
    fontWeight: theme.type.button.weight,
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
    fontWeight: theme.type.title.weight,
    marginTop: theme.spacing.md,
  },
});
