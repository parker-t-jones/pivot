import { Pressable, StyleSheet, Text, View } from 'react-native';

import { pickGameStatusLabel, type PickGameAvailability } from '../lib/addPickGames';
import { scoreBlockWash } from '../lib/teamColors';
import { theme } from '../lib/theme';
import { TeamBadge } from './TeamBadge';

export interface AddPickGameRowModel {
  gameId: string;
  away: string;
  home: string;
  awayTeamId: string | null;
  homeTeamId: string | null;
  detail: string;
  availability: PickGameAvailability;
  context: string | null;
}

export interface AddPickGameGroupModel {
  label: string;
  rows: AddPickGameRowModel[];
}

/**
 * One slate row. `side` picks the game and the team from a half.
 * `game` picks the game from anywhere on the row (totals).
 */
export function AddPickGameList({
  groups,
  mode,
  onPickSide,
  onPickGame,
}: {
  groups: readonly AddPickGameGroupModel[];
  mode: 'side' | 'game';
  onPickSide: (gameId: string, teamId: string) => void;
  onPickGame: (gameId: string) => void;
}) {
  return (
    <View style={styles.stack}>
      {groups.map((group) => (
        <View key={group.label} style={styles.group}>
          <Text style={styles.groupLabel}>{group.label}</Text>
          {group.rows.map((row) => (
            <GameRow
              key={row.gameId}
              mode={mode}
              onPickGame={onPickGame}
              onPickSide={onPickSide}
              row={row}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

function GameRow({
  row,
  mode,
  onPickSide,
  onPickGame,
}: {
  row: AddPickGameRowModel;
  mode: 'side' | 'game';
  onPickSide: (gameId: string, teamId: string) => void;
  onPickGame: (gameId: string) => void;
}) {
  const closed = row.availability !== 'open';
  const status = pickGameStatusLabel(row.availability);
  const halves = (
    <View style={[styles.halves, closed && styles.closed]}>
      <TeamHalf
        abbr={row.away}
        disabled={
          closed || (mode === 'side' && (row.awayTeamId == null || row.awayTeamId.length === 0))
        }
        onPress={
          mode === 'side' && row.awayTeamId
            ? () => onPickSide(row.gameId, row.awayTeamId ?? '')
            : undefined
        }
        testID={`add-pick-side-${row.gameId}-${row.away}`}
      />
      <TeamHalf
        abbr={row.home}
        disabled={
          closed || (mode === 'side' && (row.homeTeamId == null || row.homeTeamId.length === 0))
        }
        edge
        onPress={
          mode === 'side' && row.homeTeamId
            ? () => onPickSide(row.gameId, row.homeTeamId ?? '')
            : undefined
        }
        testID={`add-pick-side-${row.gameId}-${row.home}`}
      />
    </View>
  );

  const meta = (
    <View style={styles.meta}>
      {row.detail.length > 0 ? <Text style={styles.detail}>{row.detail}</Text> : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}
      {row.context ? <Text style={styles.context}>{row.context}</Text> : null}
    </View>
  );

  if (mode === 'game') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: closed }}
        disabled={closed}
        onPress={() => onPickGame(row.gameId)}
        style={styles.card}
        testID={`add-pick-game-${row.gameId}`}
      >
        {halves}
        {meta}
      </Pressable>
    );
  }

  return (
    <View style={styles.card} testID={`add-pick-game-${row.gameId}`}>
      {halves}
      {meta}
    </View>
  );
}

function TeamHalf({
  abbr,
  disabled,
  edge,
  onPress,
  testID,
}: {
  abbr: string;
  disabled: boolean;
  edge?: boolean;
  onPress?: () => void;
  testID: string;
}) {
  const wash = scoreBlockWash(abbr, theme.colors.background);
  const style = [styles.half, edge && styles.halfEdge, { backgroundColor: wash }];
  const body = (
    <>
      <TeamBadge abbr={abbr} size="sm" />
      <Text style={styles.abbr}>{abbr}</Text>
    </>
  );
  if (onPress == null) {
    return (
      <View style={style} testID={testID}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={style}
      testID={testID}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  abbr: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.bodyStrong.size,
    fontWeight: theme.type.bodyStrong.weight,
    lineHeight: theme.type.bodyStrong.lineHeight,
  },
  card: {
    borderColor: theme.colors.border,
    borderRadius: theme.radii.md,
    borderWidth: theme.effects.panelBorderWidth,
    overflow: 'hidden',
  },
  closed: {
    opacity: theme.opacity.disabled,
  },
  context: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.caption.size,
    lineHeight: theme.type.caption.lineHeight,
    textAlign: 'center',
  },
  detail: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption.size,
    lineHeight: theme.type.caption.lineHeight,
    textAlign: 'center',
  },
  group: {
    gap: theme.spacing.sm,
  },
  groupLabel: {
    color: theme.colors.textTertiary,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  half: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: theme.spacing.sm,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  halfEdge: {
    borderColor: theme.colors.border,
    borderLeftWidth: theme.effects.panelBorderWidth,
  },
  halves: {
    flexDirection: 'row',
  },
  meta: {
    gap: theme.spacing.xs,
    paddingBottom: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
  },
  stack: {
    gap: theme.spacing.lg,
  },
  status: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.caption.size,
    fontWeight: theme.type.bodyStrong.weight,
    lineHeight: theme.type.caption.lineHeight,
    textAlign: 'center',
  },
});
