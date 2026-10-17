import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { TeamBadge } from './TeamBadge';
import { FILLED_BUTTON_RECIPE } from '../lib/controlRecipes';
import {
  beginRemoval,
  EMPTY_REMOVAL,
  expireRemoval,
  failRemoval,
  STAKE_UNDO_MS,
  undoRemoval,
} from '../lib/deferredStakeRemoval';
import { fonts } from '../lib/fonts';
import { slotLabel } from '../lib/lineupOrder';
import type { LineupSlot } from '../lib/leagues';
import type { LiveGame, ScheduleGame } from '../lib/schedule';
import { theme } from '../lib/theme';
import { formatStakeLabel, stakeTeams, type ManualStake } from '../lib/stakes';
import { deleteStakeKeepalive } from '../lib/stakesClient';
import { supabase } from '../lib/supabase';
import { webPressState } from '../lib/webPress';
import {
  watchlistPlayerRow,
  watchlistStakeRow,
  type WatchlistTableRow,
} from '../lib/watchlistTable';
import { useSwitching } from '../contexts/SwitchingContext';
import { useUpgradeSheet } from '../contexts/UpgradeSheetContext';
import { PrimaryButton } from './PrimaryButton';
import { StreamLinkControl } from './StreamLinkControl';
import { TextButton } from './TextButton';
import type { WatchlistDesktopProps } from './WatchlistDesktop';
import { WatchlistFilters } from './WatchlistFilters';

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
  onWatchOpponent,
  onRemoveStake,
  betPrompt,
  extras,
}: WatchlistDesktopProps) {
  const { switchToGame } = useSwitching();
  const { openUpgrade } = useUpgradeSheet();
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
  const [removal, setRemoval] = useState(EMPTY_REMOVAL);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const removalRef = useRef(removal);
  removalRef.current = removal;
  const sentRef = useRef(new Set<string>());
  const removableRef = useRef(removable);
  removableRef.current = removable;
  const onRemoveRef = useRef(onRemoveStake);
  onRemoveRef.current = onRemoveStake;
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      tokenRef.current = data.session?.access_token ?? null;
    });
  }, []);

  const commitRemoval = useRef((id: string) => {
    if (sentRef.current.has(id)) return;
    const stake = removableRef.current.get(id);
    if (!stake) return;
    sentRef.current.add(id);
    void Promise.resolve(onRemoveRef.current(stake)).catch(() => {
      sentRef.current.delete(id);
      setRemoval((current) => failRemoval(current, id));
      setRemoveError('Could not remove that bet.');
    });
  });

  useEffect(() => {
    if (removal.pendingId == null) return;
    const timer = setTimeout(() => {
      setRemoval((current) => {
        const step = expireRemoval(current);
        if (step.commitId) commitRemoval.current(step.commitId);
        return step.state;
      });
    }, STAKE_UNDO_MS);
    return () => clearTimeout(timer);
  }, [removal.pendingId]);

  useEffect(() => {
    const commitPending = () => {
      const step = expireRemoval(removalRef.current);
      removalRef.current = step.state;
      if (step.commitId) commitRemoval.current(step.commitId);
    };
    const onUnload = () => {
      const id = removalRef.current.pendingId;
      const token = tokenRef.current;
      if (id == null || token == null || sentRef.current.has(id)) return;
      sentRef.current.add(id);
      removalRef.current = { ...removalRef.current, pendingId: null };
      deleteStakeKeepalive(id, token);
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      commitPending();
    };
  }, []);

  useEffect(() => {
    if (removeError == null) return;
    const timer = setTimeout(() => setRemoveError(null), STAKE_UNDO_MS);
    return () => clearTimeout(timer);
  }, [removeError]);

  const visibleRows = rows.filter((row) => !removal.hiddenIds.includes(row.id));

  const hideRow = (id: string) => {
    setRemoveError(null);
    setRemoval((current) => {
      const step = beginRemoval(current, id);
      if (step.commitId) commitRemoval.current(step.commitId);
      return step.state;
    });
  };

  const undo = () => {
    setRemoval((current) => undoRemoval(current).state);
  };

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
    <View style={styles.screen}>
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingTop: topInset, paddingBottom: bottomInset }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.colors.accent}
        />
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
      <View style={styles.stripRow}>
        <Text style={styles.strip}>Fantasy {weekCard.fantasy.value}</Text>
        <Text style={styles.strip}>·</Text>
        <Pressable
          accessibilityLabel={`Opponent, ${weekCard.opponent.value}`}
          accessibilityRole="button"
          accessibilityState={{ disabled: weekCard.opponent.toggleable !== true }}
          disabled={weekCard.opponent.toggleable !== true}
          onPress={() => onWatchOpponent(weekCard.opponent.value === 'Off')}
        >
          <Text
            style={[
              styles.strip,
              weekCard.opponent.toggleable === true && styles.stripToggle,
              weekCard.opponent.muted && styles.stripMuted,
            ]}
          >
            Opponent {weekCard.opponent.value}
          </Text>
        </Pressable>
        <Text style={styles.strip}>·</Text>
        <Text style={styles.strip}>
          {weekCard.bets.strip ?? `${weekCard.bets.label} ${weekCard.bets.value}`}
        </Text>
        {weekCard.bets.upgrade ? (
          <TextButton label="Upgrade" onPress={() => openUpgrade()} size="small" />
        ) : null}
        <Text style={styles.strip}>·</Text>
        <Text style={styles.strip}>Pools {weekCard.pools.value}</Text>
      </View>
      <WatchlistFilters onChange={onFilter} value={filter} />
      {extras}
      <View style={styles.table}>
        <View style={styles.head}>
          <Text style={[styles.headCell, styles.slotCol]}>Slot</Text>
          <Text style={[styles.headCell, styles.playerCol]}>Stake</Text>
          <Text style={[styles.headCell, styles.gameCol]}>Game</Text>
          <Text style={[styles.headCell, styles.networkCol]}>Network</Text>
          <Text style={[styles.headCell, styles.statusCol]}>Status</Text>
          <Text style={[styles.headCell, styles.actionCol]}> </Text>
        </View>
        {visibleRows.length === 0 && !betPrompt ? (
          <Text style={styles.empty}>Nothing in this view yet.</Text>
        ) : visibleRows.length === 0 ? null : (
          visibleRows.map((row) => (
            <TableRow
              key={row.id}
              onOpen={() => openRow(row)}
              onRemove={removable.has(row.id) ? () => hideRow(row.id) : null}
              row={row}
            />
          ))
        )}
        {betPrompt ? (
          <Pressable accessibilityRole="button" onPress={onAddStake} style={styles.promptRow}>
            <Text style={styles.prompt}>{betPrompt}</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
      {removal.pendingId || removeError ? (
        <View
          pointerEvents="box-none"
          style={[styles.toastDock, { bottom: bottomInset + theme.spacing.lg }]}
        >
          {removal.pendingId ? (
            <View style={styles.toast}>
              <Text style={styles.toastText}>Removed</Text>
              <TextButton label="Undo" onPress={undo} size="smallStrong" />
            </View>
          ) : null}
          {removeError ? (
            <View style={styles.toast}>
              <Text style={styles.toastText}>{removeError}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
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
  const teams =
    row.awayTeam && row.homeTeam
      ? { away: row.awayTeam, home: row.homeTeam }
      : row.gameId
        ? matchupTeams(row.switchLabel)
        : null;
  const [hot, setHot] = useState(false);
  const [removeFocused, setRemoveFocused] = useState(false);
  const showRemove = hot || removeFocused;
  return (
    <Pressable
      onBlur={() => setHot(false)}
      onFocus={() => setHot(true)}
      onHoverIn={() => setHot(true)}
      onHoverOut={() => setHot(false)}
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
      <View style={[styles.gameCell, styles.gameCol]}>
        {row.awayTeam && row.homeTeam ? (
          <View style={styles.matchup}>
            <TeamBadge abbr={row.awayTeam} size="sm" />
            <Text style={styles.at}>@</Text>
            <TeamBadge abbr={row.homeTeam} size="sm" />
          </View>
        ) : (
          <Text numberOfLines={1} style={[styles.game, styles.gameText]}>
            {row.game}
          </Text>
        )}
        {row.gameId && teams ? (
          <StreamLinkControl away={teams.away} gameId={row.gameId} home={teams.home} />
        ) : null}
      </View>
      <Text numberOfLines={1} style={[styles.network, styles.networkCol]}>
        {row.network}
      </Text>
      <Text
        numberOfLines={1}
        style={[
          styles.status,
          row.statusMuted && styles.statusMuted,
          row.live && styles.statusLive,
          styles.statusCol,
        ]}
      >
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
          <Pressable
            accessibilityLabel="Remove"
            accessibilityRole="button"
            onBlur={() => setRemoveFocused(false)}
            onFocus={() => setRemoveFocused(true)}
            onPress={onRemove}
            pointerEvents={showRemove ? 'auto' : 'none'}
            style={[styles.removeHit, !showRemove && styles.removeHidden]}
          >
            <Text style={styles.removeLabel}>Remove</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

function matchupTeams(label: string): { away: string; home: string } {
  const [away = '', home = ''] = label.split(' @ ');
  return { away: away.trim(), home: home.trim() };
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

const styles = StyleSheet.create({
  at: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.small.size,
  },
  matchup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  prompt: {
    color: theme.colors.accent,
    fontSize: theme.type.smallStrong.size,
    fontWeight: theme.type.smallStrong.weight,
  },
  promptRow: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  removeHidden: {
    opacity: 0,
  },
  removeHit: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.sm,
  },
  removeLabel: {
    color: theme.colors.danger,
    fontSize: theme.type.smallStrong.size,
    fontWeight: theme.type.smallStrong.weight,
  },
  stripMuted: {
    color: theme.colors.textTertiary,
  },
  stripToggle: {
    color: theme.colors.textPrimary,
  },
  toast: {
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radii.control,
    flexDirection: 'row',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  toastDock: {
    alignItems: 'center',
    gap: theme.spacing.sm,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  toastText: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.small.size,
  },
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
  gameCell: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  gameText: {
    flexShrink: 1,
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
  scroll: {
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
    color: theme.colors.textSecondary,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.ticker.size,
  },
  statusMuted: {
    color: theme.colors.textTertiary,
  },
  statusCol: {
    width: 148,
  },
  statusLive: {
    color: theme.colors.flare,
  },
  strip: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.small.size,
    lineHeight: theme.type.small.lineHeight,
  },
  stripRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
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
