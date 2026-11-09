import { networkLabelFromAirings } from '@pivot/shared/broadcast';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useUpgradeSheet } from '../contexts/UpgradeSheetContext';
import {
  LEG_KIND_COPY,
  PICK_KIND_COPY,
  addPickEyebrow,
  addPickSlipPickLabel,
  isLegKind,
  kindAllowsLive,
  pickSteps,
  type PickKind,
  type PickStep,
} from '../lib/addPickFlow';
import { notifyAddPickSaved } from '../lib/addPickDrawer';
import {
  gameTracksKind,
  groupPickGames,
  pickGameAvailability,
  pickGameContextLine,
  pickGameSelectable,
  playerGame,
  playerResultSubtitle,
  starterCountsByGame,
} from '../lib/addPickGames';
import { addPickReviewNote, stepMagnitude } from '../lib/addPickLine';
import { resolveActiveLeagueId } from '../lib/activeLeague';
import { confirmAsync } from '../lib/confirm';
import { fetchLeagues, fetchLineup, type LineupSlot } from '../lib/leagues';
import { fetchMe } from '../lib/me';
import { fetchNflState } from '../lib/nflState';
import {
  EMPTY_DRAFT,
  buildPickInput,
  draftLine,
  draftLineConfig,
  draftLineReady,
  draftPickBadge,
  draftPickText,
  draftReadout,
  pickInputLabel,
  samePickInput,
  withLineReset,
  type DraftGame,
  type PickDraft,
} from '../lib/pickDraft';
import {
  TEAM_MARKETS,
  defaultPeriod,
  playerHasProps,
  playerMarketsFor,
  teamMarket,
  type PlayerMarketKey,
  type TeamMarketKey,
} from '../lib/pickMarkets';
import {
  createPick,
  createSlip,
  fetchPicks,
  freePicksLeft,
  type PickInput,
  type PicksPageRow,
} from '../lib/picksClient';
import type { PlayerSearchResult } from '../lib/players';
import { fetchGamesWeek, type ScheduleGame } from '../lib/schedule';
import { stakeRequestError } from '../lib/stakesClient';
import { theme } from '../lib/theme';
import { promptUpgradeForCapError } from '../lib/upgradePrompt';
import { AddPickGameList, type AddPickGameGroupModel } from './AddPickGameList';
import { AddPickLineEntry } from './AddPickLineEntry';
import { AddPickParlay, PARLAY_MAX_LEGS } from './AddPickParlay';
import { AddPickReview } from './AddPickReview';
import { AddPickSlip, type AddPickSlipGame, type AddPickSlipLeg } from './AddPickSlip';
import { AddPickTypeStep } from './AddPickTypeStep';
import { DemoEditingBanner } from './DemoEditingBanner';
import { ErrorState } from './ErrorState';
import { ListRow } from './ListRow';
import { LoadingState } from './LoadingState';
import { PlayerSearchField } from './PlayerSearchField';
import { TextButton } from './TextButton';

interface Allowance {
  isPro: boolean;
  /** Null while unknown, or for Pro, where the count is hidden. */
  freeLeft: number | null;
}

/** A leg already added to the parlay being built. */
interface ParlayLeg {
  key: string;
  input: PickInput;
  game: DraftGame;
  text: string;
  badge: string | null;
}

const DUPLICATE_LEG = 'That leg is already in this parlay.';

/**
 * The add-a-pick steps. Phone renders this full screen. The wide desktop drawer
 * renders the same tree over the current tab.
 *
 * Every pick saves through `POST /picks`. A parlay is built leg by leg through the same steps
 * as a single pick, then saved as one pick (docs/P2-PICKS-MODEL.md §2).
 *
 * Favorite and underdog start unset, so Continue stays off until both the
 * segment and a valid number are set.
 */
export function AddPickFlow({
  onDismiss,
  closeAffordance = 'header',
}: {
  onDismiss: () => void;
  /** The drawer already draws ×. The phone header draws one once Back is hidden. */
  closeAffordance?: 'header' | 'parent';
}) {
  const insets = useSafeAreaInsets();
  const { openUpgrade } = useUpgradeSheet();
  const [step, setStep] = useState<PickStep>('type');
  const [draft, setDraft] = useState<PickDraft>(EMPTY_DRAFT);
  /** Null for a single pick. A list (even empty) while a parlay is being built. */
  const [parlayLegs, setParlayLegs] = useState<ParlayLeg[] | null>(null);
  const legKey = useRef(0);
  const [games, setGames] = useState<ScheduleGame[]>([]);
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [loadingGames, setLoadingGames] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  const [picks, setPicks] = useState<PicksPageRow[]>([]);
  const [slots, setSlots] = useState<LineupSlot[]>([]);
  const [editsLocked, setEditsLocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingGames(true);
      setGamesError(null);
      try {
        const nfl = await fetchNflState();
        const slate = await fetchGamesWeek(nfl.week);
        if (!cancelled) setGames(slate.games);
      } catch {
        if (!cancelled) setGamesError('Could not load this week’s games.');
      } finally {
        if (!cancelled) setLoadingGames(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [me, nfl] = await Promise.all([fetchMe(), fetchNflState()]);
        const [picksPage, leagues] = await Promise.all([fetchPicks(nfl.week), fetchLeagues()]);
        if (cancelled) return;
        const isPro = me.subscription_tier === 'pro';
        setEditsLocked(me.is_demo === true);
        setPicks(picksPage.picks);
        // The API counts a parlay as one slot and keeps spent slots spent (#9, #10).
        setAllowance({ isPro, freeLeft: freePicksLeft(picksPage, isPro) });
        const leagueId = resolveActiveLeagueId(leagues, me.preferences.watchedLeagueIds);
        if (leagueId == null) return;
        try {
          const lineup = await fetchLineup(leagueId, nfl.week);
          if (!cancelled) setSlots(lineup.slots);
        } catch {
          if (!cancelled) setSlots([]);
        }
      } catch {
        if (!cancelled) setAllowance({ isPro: false, freeLeft: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const reloadGames = () => {
    setLoadingGames(true);
    setGamesError(null);
    void (async () => {
      try {
        const nfl = await fetchNflState();
        const slate = await fetchGamesWeek(nfl.week);
        setGames(slate.games);
      } catch {
        setGamesError('Could not load this week’s games.');
      } finally {
        setLoadingGames(false);
      }
    })();
  };

  const starterCounts = useMemo(() => starterCountsByGame(slots, games), [slots, games]);

  const inParlay = parlayLegs !== null;
  const kind = draft.kind;
  const steps = pickSteps(kind, draft.teamMarket);
  const lineConfig = draftLineConfig(draft);
  const lineCheck = draftLine(draft);
  const readout = draftReadout(draft);
  const allowLive = kindAllowsLive(kind);

  const updateDraft = (patch: Partial<PickDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const discardParlay = async (): Promise<boolean> => {
    if (parlayLegs === null || parlayLegs.length === 0) return true;
    return await confirmAsync({
      title: 'Discard this parlay?',
      message: 'The legs you added will be removed.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep building',
      destructive: true,
    });
  };

  const goBack = () => {
    setFormError(null);
    if (step === 'legs') {
      void discardParlay().then((discard) => {
        if (!discard) return;
        setParlayLegs(null);
        setDraft(EMPTY_DRAFT);
        setStep('type');
      });
      return;
    }
    if (step === 'type') {
      if (inParlay) {
        setDraft(EMPTY_DRAFT);
        setStep('legs');
        return;
      }
      onDismiss();
      return;
    }
    const index = steps.indexOf(step);
    setStep(index > 0 ? (steps[index - 1] ?? 'type') : 'type');
  };

  const chooseKind = (next: PickKind) => {
    if (editsLocked) return;
    setFormError(null);
    if (next === 'PARLAY') {
      setParlayLegs([]);
      setDraft(EMPTY_DRAFT);
      setStep('legs');
      return;
    }
    if (inParlay && !isLegKind(next)) return;
    setDraft({ ...EMPTY_DRAFT, kind: next });
    setStep(pickSteps(next)[1] ?? 'game');
  };

  const findSelectable = (gameId: string): ScheduleGame | null => {
    const next = games.find((row) => row.game_id === gameId);
    if (!next || !pickGameSelectable(pickGameAvailability(next.status, allowLive))) return null;
    return next;
  };

  const afterGameStep = (): PickStep => (steps.includes('line') ? 'line' : 'confirm');

  const chooseSide = (gameId: string, nextTeamId: string) => {
    const next = findSelectable(gameId);
    if (next === null) return;
    const same = draft.game?.game_id === next.game_id && draft.teamId === nextTeamId;
    const updated = { ...draft, game: next, teamId: nextTeamId };
    setDraft(same ? updated : withLineReset(updated));
    setFormError(null);
    setStep(afterGameStep());
  };

  const chooseGame = (gameId: string) => {
    const next = findSelectable(gameId);
    if (next === null) return;
    const same = draft.game?.game_id === next.game_id;
    const updated = { ...draft, game: next, teamId: null };
    setDraft(same ? updated : withLineReset(updated));
    setFormError(null);
    setStep(afterGameStep());
  };

  const choosePlayer = (player: PlayerSearchResult) => {
    const game = playerGame(player, games);
    if (game === null || !pickGameSelectable(pickGameAvailability(game.status, true))) return;
    const abbreviation = player.team?.abbreviation.trim().toUpperCase() ?? '';
    const teamId =
      game.home_team.trim().toUpperCase() === abbreviation
        ? (game.home_team_id ?? null)
        : (game.away_team_id ?? null);
    const same = draft.player?.player_id === player.player_id;
    setDraft(same ? draft : withLineReset({ ...draft, player, game, teamId, playerMarket: null }));
    setFormError(null);
    setStep('market');
  };

  const choosePlayerMarket = (key: PlayerMarketKey) => {
    setDraft((current) =>
      current.playerMarket === key ? current : withLineReset({ ...current, playerMarket: key }),
    );
    setFormError(null);
    setStep('line');
  };

  const chooseTeamMarket = (key: TeamMarketKey) => {
    setDraft((current) =>
      current.teamMarket === key
        ? current
        : withLineReset({
            ...current,
            teamMarket: key,
            period: defaultPeriod(teamMarket(key)),
            game: null,
            teamId: null,
          }),
    );
    setFormError(null);
    setStep('game');
  };

  const chooseRole = (role: string) => {
    if (lineConfig === null) return;
    if (lineConfig.roleSet === 'spread')
      updateDraft({ spreadRole: role as PickDraft['spreadRole'] });
    else if (lineConfig.roleSet === 'yesNo')
      updateDraft({ eventSide: role as PickDraft['eventSide'] });
    else updateDraft({ totalRole: role as PickDraft['totalRole'] });
  };

  const slipGameFor = (game: DraftGame | null): AddPickSlipGame | null => {
    if (game === null) return null;
    const full = games.find((row) => row.game_id === game.game_id);
    return {
      away: game.away_team,
      home: game.home_team,
      detail: [
        kickoffLabel(game.scheduled_start),
        full ? networkLabelFromAirings(full.airings) : null,
        game.status === 'in_progress' ? 'Live' : null,
      ]
        .filter((part): part is string => part != null && part.length > 0)
        .join(' · '),
    };
  };

  const pickText = draftPickText(draft);
  const slipPick = pickText == null ? null : { badge: draftPickBadge(draft), text: pickText };
  const kindLabel = PICK_KIND_COPY.find((option) => option.kind === kind)?.label ?? null;

  const gameListMode: 'side' | 'game' =
    kind === 'TOTAL'
      ? 'game'
      : kind === 'TEAM_PROP' && draft.teamMarket !== null
        ? teamMarket(draft.teamMarket).mode
        : 'side';

  const groups: AddPickGameGroupModel[] =
    kind == null
      ? []
      : groupPickGames(games).map((group) => ({
          label: group.label,
          rows: group.games.map((row) => ({
            gameId: row.game_id,
            away: row.away_team,
            home: row.home_team,
            awayTeamId: row.away_team_id ?? null,
            homeTeamId: row.home_team_id ?? null,
            detail: gameSubtitle(row),
            availability: pickGameAvailability(row.status, allowLive),
            context: pickGameContextLine(
              starterCounts.get(row.game_id) ?? 0,
              gameTracksKind(picks, row.game_id, kind),
              kind,
            ),
          })),
        }));

  const lineMissingMessage = (): string =>
    lineCheck && !lineCheck.ok ? lineCheck.message : 'Finish the pick first.';

  const submitSingle = async () => {
    if (editsLocked) return;
    const input = buildPickInput(draft);
    if (input === null) {
      setFormError(lineMissingMessage());
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await createPick(input);
      notifyAddPickSaved();
      onDismiss();
    } catch (error) {
      if (!promptUpgradeForCapError(error, openUpgrade)) {
        setFormError(stakeRequestError(error));
      }
    } finally {
      setSaving(false);
    }
  };

  const addLeg = () => {
    if (parlayLegs === null) return;
    const input = buildPickInput(draft);
    if (input === null || draft.game === null) {
      setFormError(lineMissingMessage());
      return;
    }
    if (parlayLegs.some((leg) => samePickInput(leg.input, input))) {
      setFormError(DUPLICATE_LEG);
      return;
    }
    legKey.current += 1;
    setParlayLegs([
      ...parlayLegs,
      {
        key: `leg-${legKey.current}`,
        input,
        game: draft.game,
        // No per-leg TYPE row, so use the full label ("KC ML", not "KC").
        text: pickInputLabel(input, draft.game, draft.player),
        badge: draftPickBadge(draft),
      },
    ]);
    setDraft(EMPTY_DRAFT);
    setFormError(null);
    setStep('legs');
  };

  const removeLeg = (key: string) => {
    setParlayLegs((current) => (current ? current.filter((leg) => leg.key !== key) : current));
    setFormError(null);
  };

  const submitParlay = async () => {
    if (editsLocked || parlayLegs === null) return;
    setSaving(true);
    setFormError(null);
    try {
      await createSlip(parlayLegs.map((leg) => leg.input));
      notifyAddPickSaved();
      onDismiss();
    } catch (error) {
      if (!promptUpgradeForCapError(error, openUpgrade)) {
        setFormError(stakeRequestError(error));
      }
    } finally {
      setSaving(false);
    }
  };

  const slipLegs: AddPickSlipLeg[] | undefined = parlayLegs?.map((leg) => ({
    key: leg.key,
    away: leg.game.away_team,
    home: leg.game.home_team,
    pick: { badge: leg.badge, text: leg.text },
  }));

  const slip = inParlay ? (
    <AddPickSlip
      buildingLeg={step !== 'legs'}
      game={slipGameFor(draft.game)}
      legs={slipLegs}
      onRemoveLeg={editsLocked ? undefined : removeLeg}
      pick={slipPick}
      pickLabel="PICK"
      typeLabel={
        parlayLegs.length > 0
          ? `Parlay · ${parlayLegs.length} of ${PARLAY_MAX_LEGS} legs`
          : 'Parlay'
      }
    />
  ) : (
    <AddPickSlip
      game={slipGameFor(draft.game)}
      pick={slipPick}
      pickLabel={addPickSlipPickLabel(kind)}
      typeLabel={kindLabel}
    />
  );

  const playerMarkets = draft.player ? playerMarketsFor(draft.player.position) : [];

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + theme.spacing.lg }]}>
        {step === 'type' && !inParlay ? (
          closeAffordance === 'header' ? (
            <Pressable
              accessibilityLabel="Close"
              accessibilityRole="button"
              onPress={onDismiss}
              style={styles.close}
            >
              <Text style={styles.closeLabel}>×</Text>
            </Pressable>
          ) : null
        ) : (
          <TextButton label="Back" onPress={goBack} />
        )}
        <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.eyebrow}>
          {addPickEyebrow(kind, step, {
            teamMarket: draft.teamMarket,
            parlayLeg: inParlay ? parlayLegs.length + 1 : null,
          })}
        </Text>
        {editsLocked ? <DemoEditingBanner /> : null}
      </View>
      {/* A parlay's slip grows with each leg, so it scrolls with the steps instead of pinning. */}
      {inParlay ? null : slip}
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + theme.spacing.huge },
        ]}
        keyboardShouldPersistTaps="handled"
        style={styles.scroll}
      >
        {inParlay ? <View style={styles.inlineSlip}>{slip}</View> : null}

        {step === 'type' ? (
          inParlay ? (
            <AddPickTypeStep
              allowance={null}
              disabled={editsLocked}
              onChoose={chooseKind}
              onUpgrade={() => openUpgrade('stake_limit_free')}
              options={LEG_KIND_COPY}
            />
          ) : (
            <AddPickTypeStep
              allowance={allowance}
              disabled={editsLocked}
              onChoose={chooseKind}
              onUpgrade={() => openUpgrade('stake_limit_free')}
            />
          )
        ) : null}

        {step === 'legs' && parlayLegs !== null ? (
          <AddPickParlay
            disabled={editsLocked}
            error={formError}
            legCount={parlayLegs.length}
            note={allowance ? addPickReviewNote('PARLAY', allowance) : null}
            onAddLeg={() => {
              setFormError(null);
              setDraft(EMPTY_DRAFT);
              setStep('type');
            }}
            onSave={() => void submitParlay()}
            saving={saving}
          />
        ) : null}

        {step === 'player' ? (
          loadingGames ? (
            <LoadingState message="Loading games…" />
          ) : gamesError ? (
            <ErrorState message={gamesError} onRetry={reloadGames} />
          ) : (
            <View style={styles.stack} testID="add-pick-player">
              <Text style={styles.muted}>Search for a player in this week’s games.</Text>
              <PlayerSearchField
                describe={(player) => playerResultSubtitle(player, playerGame(player, games))}
                hide={(player) => !playerHasProps(player.position)}
                onSelect={choosePlayer}
                refocusAfterSelect={false}
                virtualized={false}
              />
            </View>
          )
        ) : null}

        {step === 'market' && kind === 'PLAYER_PROP' ? (
          <View style={styles.stack} testID="add-pick-market">
            {playerMarkets.map((market) => (
              <ListRow
                key={market.key}
                onPress={() => choosePlayerMarket(market.key)}
                title={market.label}
              />
            ))}
          </View>
        ) : null}

        {step === 'market' && kind === 'TEAM_PROP' ? (
          <View style={styles.stack} testID="add-pick-market">
            {TEAM_MARKETS.map((market) => (
              <ListRow
                key={market.key}
                onPress={() => chooseTeamMarket(market.key)}
                subtitle={market.explainer}
                title={market.label}
              />
            ))}
          </View>
        ) : null}

        {step === 'game' ? (
          loadingGames ? (
            <LoadingState message="Loading games…" />
          ) : gamesError ? (
            <ErrorState message={gamesError} onRetry={reloadGames} />
          ) : groups.length === 0 ? (
            <Text style={styles.muted}>No games this week.</Text>
          ) : (
            <AddPickGameList
              groups={groups}
              mode={gameListMode}
              onPickGame={chooseGame}
              onPickSide={chooseSide}
            />
          )
        ) : null}

        {step === 'line' && lineConfig !== null ? (
          <AddPickLineEntry
            canContinue={draftLineReady(draft)}
            config={lineConfig}
            error={
              draft.lineText.trim().length > 0 && lineCheck && !lineCheck.ok
                ? lineCheck.message
                : null
            }
            magnitude={draft.lineText}
            onContinue={() => {
              setFormError(null);
              setStep('confirm');
            }}
            onMagnitude={(value) => updateDraft({ lineText: value.replace(/[+−-]/g, '') })}
            onPeriod={(period) => updateDraft({ period })}
            onRole={chooseRole}
            onStep={(direction) => {
              const stepper = lineConfig.stepper;
              if (stepper === null) return;
              setDraft((current) => ({
                ...current,
                lineText: stepMagnitude(
                  current.lineText,
                  direction,
                  stepper.bounds,
                  stepper.baseline,
                ),
              }));
            }}
            period={draft.period}
            readout={readout}
          />
        ) : null}

        {step === 'confirm' && kind ? (
          <AddPickReview
            disabled={editsLocked}
            error={formError}
            note={!inParlay && allowance ? addPickReviewNote(kind, allowance) : null}
            onSubmit={inParlay ? addLeg : () => void submitSingle()}
            readout={readout}
            saving={saving}
            submitLabel={inParlay ? 'Add to parlay' : 'Add a pick'}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function kickoffLabel(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(when);
}

function gameSubtitle(game: ScheduleGame): string {
  const network = networkLabelFromAirings(game.airings);
  const time = kickoffLabel(game.scheduled_start);
  return [time, network]
    .filter((part): part is string => part != null && part.length > 0)
    .join(' · ');
}

const styles = StyleSheet.create({
  close: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
  },
  closeLabel: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.title.size,
    lineHeight: theme.type.title.lineHeight,
  },
  content: {
    gap: theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg2,
  },
  eyebrow: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  inlineSlip: {
    marginHorizontal: -theme.spacing.lg2,
  },
  header: {
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg2,
  },
  muted: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
  },
  stack: {
    gap: theme.spacing.sm,
  },
  screen: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
});
