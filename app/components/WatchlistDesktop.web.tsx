import { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { FILLED_BUTTON_RECIPE } from '../lib/controlRecipes';
import { fonts } from '../lib/fonts';
import { slotLabel } from '../lib/lineupOrder';
import type { LineupSlot } from '../lib/leagues';
import type { LiveGame, ScheduleGame } from '../lib/schedule';
import { theme } from '../lib/theme';
import { formatStakeLabel, stakeTeams, type ManualStake } from '../lib/stakes';
import type { WeekCardModel } from '../lib/weekCardModel';
import { webPressState } from '../lib/webPress';
import {
  watchlistPlayerRow,
  watchlistStakeRow,
  type WatchlistTableRow,
} from '../lib/watchlistTable';
import { useSwitching } from '../contexts/SwitchingContext';
import { PrimaryButton } from './PrimaryButton';
import { TextButton } from './TextButton';
import type { WatchlistDesktopProps } from './WatchlistDesktop';
import { WatchlistFilters } from './WatchlistFilters';

const SWITCH_TRACK = { false: theme.colors.border, true: theme.colors.accent } as const;
const SWITCH_THUMB = theme.colors.textPrimary;

/**
 * Laptop watchlist. The phone list stays in `lineup.tsx` and is what iOS renders.
 * Switch uses `switchToGame`, which opens the https URL in the click on web.
 */
export function WatchlistDesktop({
  week,
  weekCard,
  filter,
  onFilter,
  onAddStake,
  starterSlots,
  benchSlots,
  opponentSlots,
  stakes,
  pools,
  weekGames,
  liveGames,
  now,
  timeZone,
  refreshing,
  onRefresh,
  topInset,
  bottomInset,
  showOpponentToggle,
  watchOpponent,
  onWatchOpponent,
  onRemoveStake,
  extras,
}: WatchlistDesktopProps) {
  const { switchToGame } = useSwitching();
  const games = weekGames ?? [];
  const rows = useMemo(
    () => [
      ...starterSlots.map((slot) => playerRow(slot, games, liveGames, now, timeZone, false)),
      ...benchSlots.map((slot) => playerRow(slot, games, liveGames, now, timeZone, true)),
      ...opponentSlots.map((slot) => playerRow(slot, games, liveGames, now, timeZone, true)),
      ...stakes.map((stake) => stakeRow(stake, 'BET', games, liveGames, now, timeZone)),
      ...pools.map((stake) => stakeRow(stake, 'POOL', games, liveGames, now, timeZone)),
    ],
    [benchSlots, games, liveGames, now, opponentSlots, pools, stakes, starterSlots, timeZone],
  );
  const removable = useMemo(() => {
    const byId = new Map<string, ManualStake>();
    for (const stake of [...stakes, ...pools]) byId.set(stake.id, stake);
    return byId;
  }, [pools, stakes]);

  const openRow = (row: WatchlistTableRow) => {
    if (!row.live || !row.gameId) return;
    const source = games.find((game) => game.game_id === row.gameId);
    switchToGame({
      gameId: row.gameId,
      deepLinkUrl: row.deepLinkUrl,
      label: row.switchLabel,
      awayNickname: source?.away_team_name,
      homeNickname: source?.home_team_name,
      broadcasts: source?.broadcasts,
    });
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topInset, paddingBottom: bottomInset },
      ]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent} />
      }
    >
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.eyebrow}>
            {week == null ? 'WEEK' : `WEEK ${week}`}
          </Text>
          <Text maxFontSizeMultiplier={theme.fontScaleCaps.title} style={styles.title}>
            Watchlist
          </Text>
        </View>
        <View style={styles.addWrap}>
          <PrimaryButton label="Add a stake" onPress={onAddStake} />
        </View>
      </View>
      <Text style={styles.strip}>{statStrip(weekCard)}</Text>
      <WatchlistFilters onChange={onFilter} value={filter} />
      {extras}
      <View style={styles.table}>
        <View style={styles.head}>
          <Text style={[styles.headCell, styles.slotCol]}>Slot</Text>
          <Text style={[styles.headCell, styles.playerCol]}>Player</Text>
          <Text style={[styles.headCell, styles.gameCol]}>Game</Text>
          <Text style={[styles.headCell, styles.networkCol]}>Network</Text>
          <Text style={[styles.headCell, styles.statusCol]}>Status</Text>
          <Text style={[styles.headCell, styles.actionCol]}> </Text>
        </View>
        {rows.length === 0 ? (
          <Text style={styles.empty}>Nothing in this view yet.</Text>
        ) : (
          rows.map((row) => (
            <TableRow
              key={row.id}
              onOpen={() => openRow(row)}
              onRemove={
                removable.has(row.id)
                  ? () => {
                      const stake = removable.get(row.id);
                      if (stake) onRemoveStake(stake);
                    }
                  : null
              }
              row={row}
            />
          ))
        )}
      </View>
      {showOpponentToggle ? (
        <View style={styles.opponent}>
          <Text style={styles.opponentLabel}>Also watch my opponent</Text>
          <Switch
            accessibilityLabel="Also watch my opponent"
            onValueChange={onWatchOpponent}
            thumbColor={SWITCH_THUMB}
            trackColor={SWITCH_TRACK}
            value={watchOpponent}
          />
        </View>
      ) : null}
      {showOpponentToggle && !watchOpponent ? (
        <Text style={styles.hint}>See your opponent's red-zone trips on Home. No notifications.</Text>
      ) : null}
    </ScrollView>
  );
}

function TableRow({
  row,
  onOpen,
  onRemove,
}: {
  row: WatchlistTableRow & { muted: boolean };
  onOpen: () => void;
  onRemove: (() => void) | null;
}) {
  return (
    <Pressable
      accessibilityRole={row.live ? 'button' : undefined}
      onPress={row.live ? onOpen : undefined}
      style={(state) => {
        const { pressed, hovered, focused } = webPressState(state);
        return [
          styles.row,
          hovered && styles.rowHover,
          pressed && row.live && styles.rowPressed,
          focused && row.live && styles.rowFocused,
        ];
      }}
    >
      <Text numberOfLines={1} style={[styles.slot, styles.slotCol]}>
        {row.slot}
      </Text>
      <View style={styles.playerCol}>
        <Text numberOfLines={1} style={[styles.name, row.muted && styles.nameMuted]}>
          {row.name}
        </Text>
        {row.meta.length > 0 ? (
          <Text numberOfLines={1} style={styles.meta}>
            {row.meta}
          </Text>
        ) : null}
      </View>
      <Text numberOfLines={1} style={[styles.game, styles.gameCol]}>
        {row.game}
      </Text>
      <Text numberOfLines={1} style={[styles.network, styles.networkCol]}>
        {row.network}
      </Text>
      <Text numberOfLines={1} style={[styles.status, row.live && styles.statusLive, styles.statusCol]}>
        {row.status}
      </Text>
      <View style={styles.actionCol}>
        {row.live ? (
          <Pressable
            accessibilityRole="button"
            onPress={onOpen}
            style={(state) => {
              const { pressed, hovered, focused } = webPressState(state);
              return [
                styles.switchButton,
                hovered && styles.switchHover,
                pressed && styles.switchPressed,
                focused && styles.rowFocused,
              ];
            }}
          >
            <Text style={styles.switchLabel}>Switch</Text>
          </Pressable>
        ) : onRemove ? (
          <TextButton label="Remove" onPress={onRemove} size="smallStrong" tone="danger" />
        ) : null}
      </View>
    </Pressable>
  );
}

function playerRow(
  slot: LineupSlot,
  weekGames: readonly ScheduleGame[],
  liveGames: readonly LiveGame[],
  now: Date,
  timeZone: string,
  muted: boolean,
): WatchlistTableRow & { muted: boolean } {
  return {
    ...watchlistPlayerRow({
      id: slot.slot_id,
      slot: slotLabel(slot.position_in_lineup),
      name: playerDisplayName(slot),
      meta: rosterMeta(slot),
      teamAbbr: slot.player.team?.abbreviation ?? '',
      weekGames,
      liveGames,
      now,
      timeZone,
    }),
    muted,
  };
}

function stakeRow(
  stake: ManualStake,
  slot: string,
  weekGames: readonly ScheduleGame[],
  liveGames: readonly LiveGame[],
  now: Date,
  timeZone: string,
): WatchlistTableRow & { muted: boolean } {
  const game = stake.game;
  const matchup = game ? `${game.away_team} @ ${game.home_team}` : '';
  const kickoff = stakeKickoff(stake);
  return {
    ...watchlistStakeRow({
      id: stake.id,
      slot,
      name: formatStakeLabel(stake, stakeTeams(stake)),
      meta: stakeKind(stake),
      gameId: stake.game_id,
      matchup,
      kickoff,
      weekGames,
      liveGames,
      now,
      timeZone,
    }),
    muted: false,
  };
}

function stakeKind(stake: ManualStake): string {
  switch (stake.condition.type) {
    case 'SPREAD':
      return 'Spread';
    case 'TOTAL_OVER':
    case 'TOTAL_UNDER':
      return 'Total';
    case 'MONEYLINE':
      return 'Moneyline';
    case 'SURVIVOR':
      return 'Survivor';
    default:
      return '';
  }
}

function stakeKickoff(stake: ManualStake): string {
  if (!stake.game) return '';
  const when = new Date(stake.game.scheduled_start);
  if (Number.isNaN(when.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(when);
}

function playerDisplayName(slot: LineupSlot): string {
  const person = `${slot.player.first_name} ${slot.player.last_name}`.trim();
  if (slot.player.position.trim().toUpperCase() !== 'DEF') return person;
  const teamName = slot.player.team?.name.trim() ?? '';
  if (teamName.length > 0) return teamName;
  const abbreviation = slot.player.team?.abbreviation.trim() ?? '';
  return abbreviation.length > 0 ? abbreviation : person;
}

function rosterMeta(slot: LineupSlot): string {
  const team = slot.player.team?.abbreviation ?? '';
  const position = slot.player.position;
  if (team.length > 0 && position.length > 0) return `${team} · ${position}`;
  return team.length > 0 ? team : position;
}

function statStrip(model: WeekCardModel): string {
  return [
    `Fantasy ${model.fantasy.value}`,
    `${model.bets.label} ${model.bets.value}`,
    `Pools ${model.pools.value}`,
    `Opponent ${model.opponent.value.toLowerCase()}`,
  ].join(' · ');
}

const styles = StyleSheet.create({
  actionCol: {
    alignItems: 'flex-end',
    width: 88,
  },
  addWrap: {
    alignSelf: 'center',
    width: 160,
  },
  content: {
    gap: theme.spacing.lg,
    paddingHorizontal: theme.spacing.xl,
  },
  empty: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
    padding: theme.spacing.lg,
  },
  eyebrow: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  game: {
    color: theme.colors.textSecondary,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.ticker.size,
  },
  gameCol: {
    flex: 1.3,
    minWidth: 0,
  },
  head: {
    borderBottomColor: theme.colors.wellBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  headCell: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    textTransform: 'uppercase',
  },
  header: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: theme.spacing.lg,
    justifyContent: 'space-between',
  },
  headerCopy: {
    flexShrink: 1,
    gap: theme.spacing.xs,
  },
  hint: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption.size,
  },
  meta: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.caption.size,
  },
  name: {
    color: theme.colors.textPrimary,
    fontFamily: fonts.sansSemiBold,
    fontSize: theme.type.body.size,
  },
  nameMuted: {
    color: theme.colors.textSecondary,
  },
  network: {
    color: theme.colors.textSecondary,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.ticker.size,
  },
  networkCol: {
    width: 72,
  },
  opponent: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  opponentLabel: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.small.size,
  },
  playerCol: {
    flex: 1.4,
    gap: 2,
    minWidth: 0,
  },
  row: {
    alignItems: 'center',
    borderBottomColor: theme.colors.rowDivider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    cursor: 'pointer',
    flexDirection: 'row',
    gap: theme.spacing.md,
    minHeight: 56,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  rowFocused: {
    borderColor: theme.colors.accent,
    borderWidth: theme.effects.panelBorderWidth,
  },
  rowHover: {
    backgroundColor: theme.colors.surface,
  },
  rowPressed: {
    backgroundColor: theme.colors.surfaceRaised,
  },
  screen: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  slot: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  slotCol: {
    width: 52,
  },
  status: {
    color: theme.colors.textTertiary,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.ticker.size,
  },
  statusCol: {
    width: 88,
  },
  statusLive: {
    color: theme.colors.flare,
  },
  strip: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.small.size,
    lineHeight: theme.type.small.lineHeight,
  },
  switchButton: {
    ...FILLED_BUTTON_RECIPE,
    backgroundColor: theme.colors.accent,
    cursor: 'pointer',
    paddingVertical: theme.spacing.sm,
  },
  switchHover: {
    backgroundColor: theme.colors.accentPressed,
  },
  switchLabel: {
    color: theme.colors.onAccent,
    fontFamily: fonts.sansSemiBold,
    fontSize: theme.type.smallStrong.size,
    textAlign: 'center',
  },
  switchPressed: {
    opacity: theme.opacity.disabled,
  },
  table: {
    backgroundColor: theme.colors.well,
    borderColor: theme.colors.wellBorder,
    borderRadius: theme.radii.lg,
    borderWidth: theme.effects.panelBorderWidth,
    overflow: 'hidden',
  },
  title: {
    color: theme.colors.textPrimary,
    fontFamily: fonts.monoBold,
    fontSize: theme.type.title.size,
    letterSpacing: theme.type.title.letterSpacing,
  },
});
