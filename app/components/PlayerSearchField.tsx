import { useRef, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { TEXT_BUTTON_HIT_SLOP } from '../lib/controlRecipes';
import { queryAfterSearchReset, searchClearVisible } from '../lib/playerSearch';
import { searchPlayers, type PlayerSearchResult } from '../lib/players';
import { theme } from '../lib/theme';
import { ListRow } from './ListRow';
import { TextField } from './TextField';
import { YardLineLoader } from './YardLineLoader';

export interface PlayerResultRow {
  subtitle: string;
  disabled: boolean;
}

/**
 * Player search box and results, shared by the manual-lineup builder (`PlayerPicker`) and the
 * player-prop step of "Add a pick". Return keeps focus in the field, the clear control keeps the
 * caret on web, and choosing a result empties the query.
 */
export function PlayerSearchField({
  onSelect,
  hide,
  describe,
  virtualized = true,
  refocusAfterSelect = true,
}: {
  onSelect: (player: PlayerSearchResult) => void;
  /** Results to leave out, e.g. players already on the roster. */
  hide?: (player: PlayerSearchResult) => boolean;
  /** Row subtitle and whether the row can be chosen. Defaults to "WR · SF". */
  describe?: (player: PlayerSearchResult) => PlayerResultRow;
  /**
   * `FlatList` with a fixed height (the lineup builder). Off inside a parent `ScrollView`, where
   * a nested list of the same direction warns on native.
   */
  virtualized?: boolean;
  /** The lineup builder keeps searching after an add. A one-player step moves on instead. */
  refocusAfterSelect?: boolean;
}) {
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlayerSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const resetQuery = (refocus: boolean) => {
    setQuery(queryAfterSearchReset());
    setResults([]);
    if (refocus) inputRef.current?.focus();
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

  const visible = hide ? results.filter((player) => !hide(player)) : results;
  const renderRow = (item: PlayerSearchResult) => {
    const row = describe?.(item) ?? {
      subtitle: `${item.position} · ${item.team?.abbreviation ?? 'FA'}`,
      disabled: false,
    };
    return (
      <ListRow
        disabled={row.disabled}
        key={item.player_id}
        onPress={() => {
          if (row.disabled) return;
          onSelect(item);
          resetQuery(refocusAfterSelect);
        }}
        style={[styles.resultRow, row.disabled && styles.resultDisabled]}
        subtitle={row.subtitle}
        title={`${item.first_name} ${item.last_name}`}
      />
    );
  };

  return (
    <>
      <TextField
        blurOnSubmit={false}
        onChangeText={onSearch}
        onSubmitEditing={() => {
          inputRef.current?.focus();
        }}
        placeholder="Search players"
        ref={inputRef}
        returnKeyType="search"
        testID="player-search-field"
        trailing={
          <View pointerEvents="box-none" style={styles.clearSlot}>
            {searchClearVisible(query) ? (
              <Pressable
                accessibilityLabel="Clear search"
                accessibilityRole="button"
                hitSlop={TEXT_BUTTON_HIT_SLOP}
                onPress={() => resetQuery(true)}
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
      {isSearching ? <YardLineLoader size="section" /> : null}
      {virtualized ? (
        <FlatList
          data={visible}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item) => item.player_id}
          renderItem={({ item }) => renderRow(item)}
          style={styles.resultsList}
        />
      ) : (
        <View testID="player-search-results">{visible.map(renderRow)}</View>
      )}
    </>
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
  resultDisabled: {
    opacity: theme.opacity.disabled,
  },
  resultRow: {
    marginBottom: theme.spacing.sm,
  },
  resultsList: {
    maxHeight: 180,
  },
});
