import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState } from '../../../components/ErrorState';
import { LoadingState } from '../../../components/LoadingState';
import { SecondaryButton } from '../../../components/SecondaryButton';
import { TextButton } from '../../../components/TextButton';
import { useLeaguesGate } from '../../../contexts/LeaguesGateContext';
import { ApiRequestError } from '../../../lib/apiClient';
import { SHOW_STAR_TOGGLES } from '../../../lib/flags';
import { fonts } from '../../../lib/fonts';
import {
  disconnectLeague,
  fetchLineup,
  renameManualLeague,
  setStarPlayer,
  syncLeague,
  type LeagueSummary,
  type LineupResponse,
  type LineupSlot,
} from '../../../lib/leagues';
import { leagueChipScrollOffset, leagueChipWidth } from '../../../lib/leagueChipScroll';
import { orderLineupSlots, slotLabel } from '../../../lib/lineupOrder';
import { fetchMe, type MeResponse } from '../../../lib/me';
import { formatGameLine, gameForTeam } from '../../../lib/playerGame';
import { fetchGamesWeek, type ScheduleGame } from '../../../lib/schedule';
import { theme } from '../../../lib/theme';

const SWITCH_TRACK = { false: theme.colors.border, true: theme.colors.accent } as const;
const SWITCH_THUMB = theme.colors.textPrimary;
const STRIPE_WIDTH = 3;
const ROW_MIN_HEIGHT = 52;
const SLOT_COLUMN_WIDTH = 44;

function isBenchSlot(slot: LineupSlot): boolean {
  if (slot.slot_type === 'bench') return true;
  const raw = slot.position_in_lineup.trim().toUpperCase();
  return raw === 'BN' || raw === 'BENCH' || raw === 'IR' || raw === 'TAXI';
}

function rosterMeta(slot: LineupSlot): string {
  const team = slot.player.team?.abbreviation ?? '';
  const position = slot.player.position;
  if (team.length > 0 && position.length > 0) return `${team} · ${position}`;
  return team.length > 0 ? team : position;
}

/** DEF rows show the team name (`player.team.name`). A blank name falls back to the abbreviation. */
function playerDisplayName(slot: LineupSlot): string {
  const person = `${slot.player.first_name} ${slot.player.last_name}`.trim();
  if (slot.player.position.trim().toUpperCase() !== 'DEF') return person;
  const teamName = slot.player.team?.name.trim() ?? '';
  if (teamName.length > 0) return teamName;
  const abbreviation = slot.player.team?.abbreviation.trim() ?? '';
  return abbreviation.length > 0 ? abbreviation : person;
}

function rowAccessibilityLabel(slot: LineupSlot, gameLine: string | null): string {
  const name = playerDisplayName(slot);
  const team = slot.player.team?.abbreviation ?? '';
  const position = slot.player.position;
  const detail = [team, position].filter((part) => part.length > 0).join(' ');
  return [slotLabel(slot.position_in_lineup), name, detail, gameLine ?? '']
    .filter((part) => part.length > 0)
    .join(', ');
}

/**
 * PLAN.md §10 Lineup tab — fantasy hub. Week comes from the lineup response.
 * This week's games load with it (no polling) so each row can show the game
 * and the player's team color. Star toggles stay behind
 * `SHOW_STAR_TOGGLES`. Pull-to-refresh syncs Sleeper.
 * Live points / opponent / detail sheet deferred.
 */

/** Empty `watchedLeagueIds` means nothing has been picked yet, which Home treats as watching every league. */
function isWatchingLeague(watchedIds: Set<string>, leagueId: string): boolean {
  return watchedIds.size === 0 || watchedIds.has(leagueId);
}

function weekEyebrow(week: number | null): string {
  return week == null ? 'FANTASY' : `WEEK ${week} · FANTASY`;
}
export default function LineupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { leagues, leaguesRevision, refreshLeagues, deferConnect } = useLeaguesGate();

  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null);
  const [lineup, setLineup] = useState<LineupResponse | null>(null);
  /** `null` when this week's games did not load — rows then omit the game line. */
  const [weekGames, setWeekGames] = useState<ScheduleGame[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyLeagueId, setBusyLeagueId] = useState<string | null>(null);
  const [savingSlotId, setSavingSlotId] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);

  const selectedLeague = useMemo(
    () => leagues.find((league) => league.league_id === selectedLeagueId) ?? leagues[0] ?? null,
    [leagues, selectedLeagueId],
  );

  const watchedIds = useMemo(
    () => new Set(me?.preferences.watchedLeagueIds ?? []),
    [me],
  );

  useEffect(() => {
    if (leagues.length === 0) {
      setSelectedLeagueId(null);
      return;
    }
    setSelectedLeagueId((current) => {
      if (current && leagues.some((league) => league.league_id === current)) {
        return current;
      }
      return leagues[0]?.league_id ?? null;
    });
  }, [leagues, leaguesRevision]);

  const loadLineup = useCallback(async (league: LeagueSummary | null) => {
    if (!league) {
      setLineup(null);
      setWeekGames(null);
      setLoadError(null);
      return;
    }
    setLoadError(null);
    try {
      const response = await fetchLineup(league.league_id);
      setLineup(response);
      try {
        const slate = await fetchGamesWeek(response.week);
        setWeekGames(slate.games);
      } catch {
        setWeekGames(null);
      }
    } catch (error) {
      setLineup(null);
      setWeekGames(null);
      setLoadError(error instanceof ApiRequestError ? error.message : 'Could not load lineup.');
    }
  }, []);

  useEffect(() => {
    void fetchMe()
      .then(setMe)
      .catch(() => {
        setMe(null);
      });
  }, [leaguesRevision]);

  useEffect(() => {
    setIsLoading(true);
    void loadLineup(selectedLeague).finally(() => setIsLoading(false));
  }, [loadLineup, selectedLeague, leaguesRevision]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      if (selectedLeague?.platform === 'sleeper') {
        await syncLeague(selectedLeague.league_id);
      }
      const [rows, meResponse] = await Promise.all([refreshLeagues(), fetchMe()]);
      setMe(meResponse);
      const next =
        rows.find((league) => league.league_id === selectedLeague?.league_id) ?? rows[0] ?? null;
      await loadLineup(next);
    } catch (error) {
      Alert.alert('Refresh failed', errorMessage(error));
    } finally {
      setIsRefreshing(false);
    }
  }, [loadLineup, refreshLeagues, selectedLeague]);

  const promptRename = (league: LeagueSummary) => {
    Alert.prompt(
      'Rename league',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: (value?: string) => {
            const next = value?.trim() ?? '';
            if (next.length === 0 || next === league.name) return;
            void (async () => {
              setBusyLeagueId(league.league_id);
              try {
                await renameManualLeague(league.league_id, next);
                await refreshLeagues();
              } catch (error) {
                Alert.alert('Could not rename', errorMessage(error));
              } finally {
                setBusyLeagueId(null);
              }
            })();
          },
        },
      ],
      'plain-text',
      league.name,
    );
  };

  // Load, pull-to-refresh, and Sync all write `lineup` through `loadLineup`.
  const orderedSlots = useMemo(
    () => orderLineupSlots(lineup?.slots ?? []),
    [lineup],
  );
  const starterSlots = orderedSlots.filter((slot) => !isBenchSlot(slot));
  const benchSlots = orderedSlots.filter((slot) => isBenchSlot(slot));
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const toggleStar = async (slot: LineupSlot, value: boolean) => {
    if (!lineup) return;
    setSavingSlotId(slot.slot_id);
    try {
      await setStarPlayer(lineup.league_id, lineup.week, slot.player.player_id, value);
      await loadLineup(selectedLeague);
    } catch (error) {
      Alert.alert('Could not update star', errorMessage(error));
    } finally {
      setSavingSlotId(null);
    }
  };

  const watchingSelected =
    selectedLeague != null && isWatchingLeague(watchedIds, selectedLeague.league_id);
  const manageBusy = busyLeagueId != null && busyLeagueId === selectedLeague?.league_id;

  const openManage = () => {
    if (!selectedLeague || manageBusy) return;
    const sleeper = selectedLeague.platform === 'sleeper';
    const options = sleeper
      ? ['Sync', 'Connect another team', 'Disconnect', 'Cancel']
      : ['Edit lineup', 'Rename', 'Connect another team', 'Disconnect', 'Cancel'];
    const cancelButtonIndex = options.length - 1;
    const destructiveButtonIndex = options.indexOf('Disconnect');
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex, destructiveButtonIndex },
      (buttonIndex) => {
        const choice = options[buttonIndex];
        if (choice === 'Sync') {
          void (async () => {
            setBusyLeagueId(selectedLeague.league_id);
            try {
              await syncLeague(selectedLeague.league_id);
              const rows = await refreshLeagues();
              const next =
                rows.find((league) => league.league_id === selectedLeague.league_id) ?? null;
              await loadLineup(next);
            } catch (error) {
              Alert.alert('Sync failed', errorMessage(error));
            } finally {
              setBusyLeagueId(null);
            }
          })();
        } else if (choice === 'Edit lineup') {
          router.push(
            `/(app)/edit-manual-lineup?leagueId=${encodeURIComponent(selectedLeague.league_id)}`,
          );
        } else if (choice === 'Rename') {
          promptRename(selectedLeague);
        } else if (choice === 'Connect another team') {
          router.push('/(app)/connect-team');
        } else if (choice === 'Disconnect') {
          Alert.alert('Disconnect league?', `Remove "${selectedLeague.name}" from Pivot?`, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Disconnect',
              style: 'destructive',
              onPress: () => {
                void (async () => {
                  setBusyLeagueId(selectedLeague.league_id);
                  try {
                    await disconnectLeague(selectedLeague.league_id);
                    const rows = await refreshLeagues();
                    if (rows.length === 0) {
                      deferConnect();
                    }
                  } catch (error) {
                    Alert.alert('Could not disconnect', errorMessage(error));
                  } finally {
                    setBusyLeagueId(null);
                  }
                })();
              },
            },
          ]);
        }
      },
    );
  };

  if (isLoading && !lineup) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + theme.spacing.lg }]}>
        <LineupHeader week={null} />
        <LoadingState message="Loading lineup…" />
      </View>
    );
  }

  if (leagues.length === 0) {
    return (
      <View style={[styles.screen, styles.emptyScreen, { paddingTop: insets.top + theme.spacing.lg }]}>
        <LineupHeader week={null} />
        <Text style={styles.emptyCopy}>Connect a fantasy team to manage your lineup.</Text>
        <SecondaryButton
          label="Connect a team"
          onPress={() => router.push('/(app)/connect-team')}
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + theme.spacing.lg, paddingBottom: insets.bottom + theme.spacing.huge },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={() => void onRefresh()}
          tintColor={theme.colors.accent}
        />
      }
    >
      <LineupHeader week={lineup?.week ?? null} />

      <View style={styles.switcherBlock}>
        <LeagueSwitcher
          leagues={leagues}
          selectedLeagueId={selectedLeague?.league_id ?? null}
          onSelect={setSelectedLeagueId}
        />
        {selectedLeague ? (
          <Text style={watchingSelected ? styles.watching : styles.notWatching}>
            {watchingSelected ? 'WATCHING' : 'NOT WATCHING'}
          </Text>
        ) : null}
      </View>

      <View style={styles.rosterSection}>
        <View style={styles.rosterHeader}>
          <Text style={styles.benchEyebrow}>STARTERS</Text>
          {selectedLeague ? (
            <TextButton
              disabled={manageBusy}
              label="Manage"
              onPress={openManage}
              size="smallStrong"
            />
          ) : null}
        </View>

      {loadError ? (
        <ErrorState
          message={loadError}
          onRetry={() => {
            void loadLineup(selectedLeague);
          }}
        />
      ) : orderedSlots.length === 0 ? (
        <Text style={styles.emptyCopy}>No players in this lineup yet.</Text>
      ) : (
        <>
          {starterSlots.length > 0 ? (
            <View style={styles.rosterWell}>
              {starterSlots.map((slot, index) => (
                <PlayerRow
                  divided={index > 0}
                  key={slot.slot_id}
                  mutedName={false}
                  now={now}
                  onToggleStar={(value) => {
                    void toggleStar(slot, value);
                  }}
                  saving={savingSlotId === slot.slot_id || !lineup}
                  slot={slot}
                  timeZone={timeZone}
                  weekGames={weekGames}
                />
              ))}
            </View>
          ) : null}
          {benchSlots.length > 0 ? (
            <>
              <Text style={styles.benchEyebrow}>BENCH</Text>
              <View style={styles.rosterWell}>
                {benchSlots.map((slot, index) => (
                  <PlayerRow
                    divided={index > 0}
                    key={slot.slot_id}
                    mutedName
                    now={now}
                    onToggleStar={(value) => {
                      void toggleStar(slot, value);
                    }}
                    saving={savingSlotId === slot.slot_id || !lineup}
                    slot={slot}
                    timeZone={timeZone}
                    weekGames={weekGames}
                  />
                ))}
              </View>
            </>
          ) : null}
        </>
      )}
      </View>
    </ScrollView>
  );
}

function LineupHeader({ week }: { week: number | null }) {
  return (
    <View style={styles.headerBlock}>
      <Text style={styles.eyebrow}>{weekEyebrow(week)}</Text>
      <Text style={styles.screenTitle}>Lineup</Text>
    </View>
  );
}

const SWITCHER_GAP = theme.spacing.xs;
const SWITCHER_INSET = theme.spacing.xs;

function LeagueSwitcher({
  leagues,
  selectedLeagueId,
  onSelect,
}: {
  leagues: LeagueSummary[];
  selectedLeagueId: string | null;
  onSelect: (leagueId: string) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const offsetRef = useRef(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const scrolls = leagues.length >= 3;
  // Leading inset is outside the chip lane, so the 2.3-chip formula still peeks at the track's right edge.
  const laneWidth = Math.max(0, viewportWidth - SWITCHER_INSET);
  const chipWidth = laneWidth > 0 ? leagueChipWidth(laneWidth, SWITCHER_GAP) : 0;
  const selectedIndex = leagues.findIndex((league) => league.league_id === selectedLeagueId);

  useEffect(() => {
    if (!scrolls || chipWidth <= 0 || selectedIndex < 0) return;
    const target = leagueChipScrollOffset({
      leagueCount: leagues.length,
      selectedIndex,
      chipWidth,
      gap: SWITCHER_GAP,
      viewportWidth,
      currentOffset: offsetRef.current,
      leadingInset: SWITCHER_INSET,
      trailingInset: SWITCHER_INSET,
    });
    if (Math.abs(target - offsetRef.current) < 0.5) return;
    offsetRef.current = target;
    scrollRef.current?.scrollTo({ x: target, animated: true });
  }, [chipWidth, leagues.length, scrolls, selectedIndex, viewportWidth]);

  const chips = leagues.map((league) => {
    const selected = league.league_id === selectedLeagueId;
    return (
      <Pressable
        key={league.league_id}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={() => onSelect(league.league_id)}
        style={[
          styles.switcherChip,
          scrolls ? { width: chipWidth } : styles.switcherChipFill,
          selected && styles.switcherChipSelected,
        ]}
      >
        <Text
          ellipsizeMode="tail"
          numberOfLines={1}
          style={[styles.switcherChipLabel, selected && styles.switcherChipLabelSelected]}
        >
          {league.name}
        </Text>
      </Pressable>
    );
  });

  if (!scrolls) {
    return <View style={[styles.switcherTrack, styles.switcherFit]}>{chips}</View>;
  }

  return (
    <View style={[styles.switcherTrack, styles.switcherScrollTrack]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        contentContainerStyle={styles.switcherContent}
        onLayout={(event) => {
          const width = event.nativeEvent.layout.width;
          setViewportWidth((current) => (current === width ? current : width));
        }}
        onScroll={(event) => {
          offsetRef.current = event.nativeEvent.contentOffset.x;
        }}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        style={styles.switcherScroll}
      >
        {chips}
      </ScrollView>
    </View>
  );
}

function PlayerRow({
  slot,
  divided,
  mutedName,
  saving,
  weekGames,
  now,
  timeZone,
  onToggleStar,
}: {
  slot: LineupSlot;
  divided: boolean;
  mutedName: boolean;
  saving: boolean;
  weekGames: ScheduleGame[] | null;
  now: Date;
  timeZone: string;
  onToggleStar: (value: boolean) => void;
}) {
  const name = playerDisplayName(slot);
  const teamId = slot.player.team?.abbreviation ?? '';
  const game = weekGames == null ? null : gameForTeam(weekGames, teamId, now);
  const gameLine = game == null ? null : formatGameLine(game, now, timeZone);
  const stripeColor =
    game != null && game.kind !== 'bye' && game.teamColor != null
      ? game.teamColor
      : theme.colors.wellBorder;
  return (
    <View style={[styles.playerRow, divided && styles.playerRowDivider]}>
      <View style={[styles.stripe, { backgroundColor: stripeColor }]} />
      <View
        accessibilityLabel={rowAccessibilityLabel(slot, gameLine)}
        accessible
        style={styles.playerMain}
      >
        <Text numberOfLines={1} style={styles.slotTag}>
          {slotLabel(slot.position_in_lineup)}
        </Text>
        <View style={styles.playerInfo}>
          <Text numberOfLines={1} style={[styles.playerName, mutedName && styles.benchName]}>
            {name}
          </Text>
          <Text numberOfLines={1} style={styles.playerMeta}>
            {rosterMeta(slot)}
          </Text>
        </View>
        {gameLine ? (
          <Text numberOfLines={1} style={[styles.gameLine, gameLineToneStyle(gameLine)]}>
            {gameLine}
          </Text>
        ) : null}
      </View>
      {SHOW_STAR_TOGGLES ? (
        <Switch
          disabled={saving}
          onValueChange={onToggleStar}
          thumbColor={SWITCH_THUMB}
          trackColor={SWITCH_TRACK}
          value={slot.is_star}
        />
      ) : null}
    </View>
  );
}

function gameLineToneStyle(line: string): { color: string } | null {
  if (line === 'LIVE') return styles.gameLineLive;
  if (line.startsWith('TODAY')) return styles.gameLineToday;
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : 'Something went wrong.';
}

const styles = StyleSheet.create({
  content: {
    gap: theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg2,
  },
  benchEyebrow: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    textTransform: 'uppercase',
  },
  benchName: {
    color: theme.colors.textSecondary,
  },
  gameLine: {
    color: theme.colors.textTertiary,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.ticker.size,
    fontVariant: [...theme.type.ticker.fontVariant],
    fontWeight: '400',
  },
  gameLineLive: {
    color: theme.colors.flare,
  },
  gameLineToday: {
    color: theme.colors.accent,
  },
  emptyCopy: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
    marginTop: theme.spacing.md,
  },
  emptyScreen: {
    gap: theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg2,
  },
  eyebrow: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    textTransform: 'uppercase',
  },
  headerBlock: {
    gap: theme.spacing.xs,
  },
  notWatching: {
    color: theme.colors.textTertiary,
    fontFamily: fonts.monoBold,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  playerInfo: {
    flex: 1,
    paddingRight: theme.spacing.sm,
  },
  playerMain: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    minHeight: ROW_MIN_HEIGHT,
  },
  playerMeta: {
    color: theme.colors.textTertiary,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.caption.size,
    fontWeight: '400',
    marginTop: 2,
  },
  playerName: {
    color: theme.colors.textPrimary,
    fontFamily: fonts.sansSemiBold,
    fontSize: theme.type.body.size,
    fontWeight: '400',
  },
  playerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: ROW_MIN_HEIGHT,
    paddingRight: theme.spacing.md,
  },
  playerRowDivider: {
    borderTopColor: theme.colors.rowDivider,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rosterHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rosterSection: {
    gap: theme.spacing.sm,
  },
  rosterWell: {
    backgroundColor: theme.colors.well,
    borderColor: theme.colors.wellBorder,
    borderRadius: theme.radii.md,
    borderWidth: theme.effects.panelBorderWidth,
    overflow: 'hidden',
  },
  screen: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  screenTitle: {
    color: theme.colors.textPrimary,
    fontFamily: fonts.sansBold,
    fontSize: theme.type.heading.size,
    fontWeight: '400',
  },
  slotTag: {
    color: theme.colors.brass,
    fontFamily: fonts.monoBold,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    marginLeft: theme.spacing.md,
    textTransform: 'uppercase',
    width: SLOT_COLUMN_WIDTH,
  },
  stripe: {
    alignSelf: 'stretch',
    width: STRIPE_WIDTH,
  },
  switcherBlock: {
    gap: theme.spacing.sm,
  },
  switcherChip: {
    alignItems: 'center',
    borderRadius: theme.radii.md,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  switcherChipFill: {
    flex: 1,
  },
  switcherChipLabel: {
    color: theme.colors.textTertiary,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    textAlign: 'center',
    textTransform: 'uppercase',
    width: '100%',
  },
  switcherChipLabelSelected: {
    color: theme.colors.accent,
  },
  switcherChipSelected: {
    backgroundColor: theme.colors.surfaceRaised,
  },
  switcherContent: {
    alignItems: 'stretch',
    gap: theme.spacing.xs,
    padding: theme.spacing.xs,
  },
  switcherFit: {
    flexDirection: 'row',
    padding: theme.spacing.xs,
  },
  switcherScroll: {
    flexGrow: 0,
    width: '100%',
  },
  switcherScrollTrack: {
    overflow: 'hidden',
  },
  switcherTrack: {
    backgroundColor: theme.colors.well,
    borderColor: theme.colors.wellBorder,
    borderRadius: theme.radii.md,
    borderWidth: theme.effects.panelBorderWidth,
    flexGrow: 0,
  },
  watching: {
    color: theme.colors.brass,
    fontFamily: fonts.monoBold,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
});
