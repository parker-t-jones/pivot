import { FlatList, StyleSheet, Text, View } from 'react-native';

import { ErrorState } from './ErrorState';
import { PlayerSearchField } from './PlayerSearchField';
import { PrimaryButton } from './PrimaryButton';
import { TextButton } from './TextButton';
import type { PlayerSearchResult } from '../lib/players';
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
  const rosteredIds = new Set(roster.map((p) => p.player_id));

  const rosterHeading =
    maxRosterSize != null
      ? `Your roster (${roster.length}/${maxRosterSize})`
      : `Your roster (${roster.length})`;

  return (
    <View style={styles.content}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>

      <PlayerSearchField hide={(player) => rosteredIds.has(player.player_id)} onSelect={onAdd} />

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

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg2,
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
