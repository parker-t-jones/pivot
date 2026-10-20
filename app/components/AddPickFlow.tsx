import { networkLabelFromAirings } from '@pivot/shared/broadcast';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useUpgradeSheet } from '../contexts/UpgradeSheetContext';
import {
  PICK_KIND_COPY,
  addPickEyebrow,
  addPickSlipPickLabel,
  addPickSlipPickText,
  pickNeedsLine,
  pickNeedsTeam,
  stakeTypeForKind,
  type PickKind,
  type PickStep,
} from '../lib/addPickFlow';
import { notifyAddPickSaved } from '../lib/addPickDrawer';
import {
  gameTracksKind,
  groupPickGames,
  pickGameAvailability,
  pickGameContextLine,
  starterCountsByGame,
} from '../lib/addPickGames';
import {
  addPickReviewNote,
  lineBaseline,
  lineBounds,
  spreadLineInput,
  spreadReadout,
  stepMagnitude,
  totalReadout,
  type SpreadRole,
  type TotalRole,
} from '../lib/addPickLine';
import { resolveActiveLeagueId } from '../lib/activeLeague';
import { fetchLeagues, fetchLineup, type LineupSlot } from '../lib/leagues';
import { fetchMe } from '../lib/me';
import { fetchNflState } from '../lib/nflState';
import { fetchGamesWeek, type ScheduleGame } from '../lib/schedule';
import { buildStakeRequest, validateLine, type ManualStake } from '../lib/stakes';
import { createStake, fetchStakes, stakeRequestError } from '../lib/stakesClient';
import { teamName } from '../lib/teamColors';
import { theme } from '../lib/theme';
import { promptUpgradeForCapError } from '../lib/upgradePrompt';
import { FREE_BET_ALLOWANCE, freeBetCount } from '../lib/weekCardModel';
import { AddPickGameList, type AddPickGameGroupModel } from './AddPickGameList';
import { AddPickLineEntry } from './AddPickLineEntry';
import { AddPickReview } from './AddPickReview';
import { AddPickSlip } from './AddPickSlip';
import { AddPickTypeStep } from './AddPickTypeStep';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';
import { TextButton } from './TextButton';

interface Allowance {
  isPro: boolean;
  /** Null while unknown, or for Pro, where the count is hidden. */
  freeLeft: number | null;
}

/**
 * The add-a-pick steps. Phone renders this full screen. The wide desktop drawer
 * renders the same tree over the current tab.
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
  const [kind, setKind] = useState<PickKind | null>(null);
  const [spreadRole, setSpreadRole] = useState<SpreadRole | null>(null);
  const [totalRole, setTotalRole] = useState<TotalRole | null>(null);
  const [games, setGames] = useState<ScheduleGame[]>([]);
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [loadingGames, setLoadingGames] = useState(true);
  const [game, setGame] = useState<ScheduleGame | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [lineText, setLineText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  const [stakes, setStakes] = useState<ManualStake[]>([]);
  const [slots, setSlots] = useState<LineupSlot[]>([]);

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
        const [stakePage, leagues] = await Promise.all([fetchStakes(nfl.week), fetchLeagues()]);
        if (cancelled) return;
        const isPro = me.subscription_tier === 'pro';
        setStakes(stakePage.stakes);
        setAllowance({
          isPro,
          freeLeft: isPro ? null : Math.max(0, FREE_BET_ALLOWANCE - freeBetCount(stakePage.stakes)),
        });
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

  const totalSide = totalRole === 'under' ? 'TOTAL_UNDER' : 'TOTAL_OVER';
  const type = kind === null ? null : stakeTypeForKind(kind, totalSide);
  const lineReady =
    kind === 'SPREAD' ? spreadRole != null : kind === 'TOTAL' ? totalRole != null : false;
  const lineInput =
    kind === 'SPREAD' && spreadRole != null
      ? spreadLineInput(spreadRole, lineText)
      : lineText.trim();
  const lineCheck =
    type !== null && kind !== null && pickNeedsLine(kind) && lineReady
      ? validateLine(type, lineInput)
      : null;

  const goBack = () => {
    setFormError(null);
    if (step === 'confirm') {
      setStep(kind !== null && pickNeedsLine(kind) ? 'line' : 'game');
      return;
    }
    if (step === 'line') {
      setStep('game');
      return;
    }
    if (step === 'game') {
      setStep('type');
      return;
    }
    onDismiss();
  };

  const resetLine = () => {
    setLineText('');
    setSpreadRole(null);
    setTotalRole(null);
  };

  const chooseKind = (next: PickKind) => {
    setKind(next);
    setGame(null);
    setTeamId(null);
    resetLine();
    setFormError(null);
    setStep('game');
  };

  const chooseSide = (gameId: string, nextTeamId: string) => {
    const next = games.find((row) => row.game_id === gameId);
    if (!next || pickGameAvailability(next.status) !== 'open') return;
    const same = game?.game_id === next.game_id && teamId === nextTeamId;
    setGame(next);
    setTeamId(nextTeamId);
    if (!same) resetLine();
    setFormError(null);
    setStep(kind !== null && pickNeedsLine(kind) ? 'line' : 'confirm');
  };

  const chooseGame = (gameId: string) => {
    const next = games.find((row) => row.game_id === gameId);
    if (!next || pickGameAvailability(next.status) !== 'open') return;
    const same = game?.game_id === next.game_id;
    setGame(next);
    setTeamId(null);
    if (!same) resetLine();
    setFormError(null);
    setStep('line');
  };

  const abbreviation =
    game === null || teamId === null
      ? ''
      : teamId === game.home_team_id
        ? game.home_team
        : teamId === game.away_team_id
          ? game.away_team
          : '';

  const nickname =
    teamName(abbreviation) ??
    (game && teamId === game.home_team_id
      ? game.home_team_name
      : game && teamId === game.away_team_id
        ? game.away_team_name
        : abbreviation);

  const readout =
    lineCheck?.ok === true && lineCheck.line !== undefined
      ? kind === 'SPREAD' && spreadRole != null && nickname.length > 0
        ? spreadReadout(nickname, spreadRole, Math.abs(lineCheck.line))
        : kind === 'TOTAL' && totalRole != null
          ? totalReadout(totalRole, lineCheck.line)
          : null
      : null;

  const kindLabel = PICK_KIND_COPY.find((option) => option.kind === kind)?.label ?? null;
  const pickText = addPickSlipPickText({
    kind,
    team: abbreviation,
    totalSide,
    lineOk: lineCheck?.ok === true,
    lineText,
    lineInput,
  });
  const slipGame = game
    ? {
        away: game.away_team,
        home: game.home_team,
        detail: [kickoffLabel(game.scheduled_start), networkLabelFromAirings(game.airings)]
          .filter((part): part is string => part != null && part.length > 0)
          .join(' · '),
      }
    : null;

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
            availability: pickGameAvailability(row.status),
            context: pickGameContextLine(
              starterCounts.get(row.game_id) ?? 0,
              gameTracksKind(stakes, row.game_id, kind),
              kind,
            ),
          })),
        }));

  const submit = async () => {
    if (type === null || game === null || kind === null) return;
    if (pickNeedsTeam(kind) && (teamId === null || teamId.length === 0)) {
      setFormError('Pick a team in that game.');
      return;
    }
    if (pickNeedsLine(kind)) {
      if (lineCheck === null || !lineCheck.ok || lineCheck.line === undefined) {
        setFormError(lineCheck && !lineCheck.ok ? lineCheck.message : 'Enter a line.');
        return;
      }
    }
    setSaving(true);
    setFormError(null);
    try {
      await createStake(
        buildStakeRequest({
          type,
          gameId: game.game_id,
          ...(teamId ? { teamId } : {}),
          ...(lineCheck && lineCheck.ok && lineCheck.line !== undefined
            ? { line: lineCheck.line }
            : {}),
        }),
      );
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

  const canContinue = lineCheck?.ok === true && lineCheck.line !== undefined;

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + theme.spacing.lg }]}>
        {step === 'type' ? (
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
          {addPickEyebrow(kind, step)}
        </Text>
      </View>
      <AddPickSlip
        game={slipGame}
        pick={
          pickText == null
            ? null
            : { badge: kind === 'TOTAL' ? null : abbreviation || null, text: pickText }
        }
        pickLabel={addPickSlipPickLabel(kind)}
        typeLabel={kindLabel}
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + theme.spacing.huge },
        ]}
        keyboardShouldPersistTaps="handled"
        style={styles.scroll}
      >
        {step === 'type' ? (
          <AddPickTypeStep
            allowance={allowance}
            onChoose={chooseKind}
            onUpgrade={() => openUpgrade('stake_limit_free')}
          />
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
              mode={kind === 'TOTAL' ? 'game' : 'side'}
              onPickGame={chooseGame}
              onPickSide={chooseSide}
            />
          )
        ) : null}

        {step === 'line' && (kind === 'SPREAD' || kind === 'TOTAL') ? (
          <AddPickLineEntry
            canContinue={canContinue}
            error={
              lineText.trim().length > 0 && lineCheck && !lineCheck.ok ? lineCheck.message : null
            }
            kind={kind}
            magnitude={lineText}
            onContinue={() => {
              setFormError(null);
              setStep('confirm');
            }}
            onMagnitude={(value) => setLineText(value.replace(/[+\u2212-]/g, ''))}
            onRole={(next) => {
              if (kind === 'SPREAD') setSpreadRole(next as SpreadRole);
              else setTotalRole(next as TotalRole);
            }}
            onStep={(direction) =>
              setLineText((current) =>
                stepMagnitude(current, direction, lineBounds(kind), lineBaseline(kind)),
              )
            }
            readout={readout}
            role={kind === 'SPREAD' ? spreadRole : totalRole}
          />
        ) : null}

        {step === 'confirm' && kind ? (
          <AddPickReview
            error={formError}
            note={allowance ? addPickReviewNote(kind, allowance) : null}
            onSubmit={() => void submit()}
            readout={readout}
            saving={saving}
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
  header: {
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg2,
  },
  muted: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
  },
  screen: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
});
