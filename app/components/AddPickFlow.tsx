import { networkLabelFromAirings } from '@pivot/shared/broadcast';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  PICK_KIND_COPY,
  addPickEyebrow,
  addPickSlipLines,
  pickNeedsLine,
  pickNeedsTeam,
  stakeTypeForKind,
  type PickKind,
  type PickStep,
} from '../lib/addPickFlow';
import { notifyAddPickSaved } from '../lib/addPickDrawer';
import { AddPickTypeStep } from './AddPickTypeStep';
import { ErrorState } from './ErrorState';
import { ListRow } from './ListRow';
import { LoadingState } from './LoadingState';
import { PrimaryButton } from './PrimaryButton';
import { SlipPerforation } from './SlipPerforation';
import { TextButton } from './TextButton';
import { TextField } from './TextField';
import { useUpgradeSheet } from '../contexts/UpgradeSheetContext';
import { fetchNflState } from '../lib/nflState';
import { fetchGamesWeek, type ScheduleGame } from '../lib/schedule';
import { buildStakeRequest, formatStakeLabel, validateLine } from '../lib/stakes';
import { createStake, fetchStakes, stakeRequestError } from '../lib/stakesClient';
import { theme } from '../lib/theme';
import { promptUpgradeForCapError } from '../lib/upgradePrompt';
import { FREE_BET_ALLOWANCE, freeBetCount } from '../lib/weekCardModel';
import { fetchMe } from '../lib/me';

interface Allowance {
  isPro: boolean;
  /** Null while unknown, or for Pro, where the count is hidden. */
  freeLeft: number | null;
}

function AddPickSlip({ lines }: { lines: readonly string[] }) {
  return (
    <View style={styles.slip}>
      {lines.map((line) => (
        <Text key={line} style={styles.slipLine}>
          {line}
        </Text>
      ))}
      <SlipPerforation />
    </View>
  );
}

/**
 * The add-a-pick steps. Phone renders this full screen. The wide desktop drawer
 * renders the same tree over the current tab.
 */
export function AddPickFlow({ onDismiss }: { onDismiss: () => void }) {
  const insets = useSafeAreaInsets();
  const { openUpgrade } = useUpgradeSheet();
  const [step, setStep] = useState<PickStep>('type');
  const [kind, setKind] = useState<PickKind | null>(null);
  const [totalSide, setTotalSide] = useState<'TOTAL_OVER' | 'TOTAL_UNDER'>('TOTAL_OVER');
  const [games, setGames] = useState<ScheduleGame[]>([]);
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [loadingGames, setLoadingGames] = useState(true);
  const [game, setGame] = useState<ScheduleGame | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [lineText, setLineText] = useState('');
  const [spreadNegative, setSpreadNegative] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [allowance, setAllowance] = useState<Allowance | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingGames(true);
      setGamesError(null);
      try {
        const nfl = await fetchNflState();
        const slate = await fetchGamesWeek(nfl.week);
        if (!cancelled) setGames(slate.games.filter((row) => row.status !== 'final'));
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
        const stakes = await fetchStakes(nfl.week);
        if (cancelled) return;
        const isPro = me.subscription_tier === 'pro';
        setAllowance({
          isPro,
          freeLeft: isPro ? null : Math.max(0, FREE_BET_ALLOWANCE - freeBetCount(stakes.stakes)),
        });
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
        setGames(slate.games.filter((row) => row.status !== 'final'));
      } catch {
        setGamesError('Could not load this week’s games.');
      } finally {
        setLoadingGames(false);
      }
    })();
  };

  const type = kind === null ? null : stakeTypeForKind(kind, totalSide);
  const lineInput =
    kind === 'SPREAD' ? `${spreadNegative ? '-' : '+'}${lineText.trim()}` : lineText.trim();
  const lineCheck =
    type !== null && kind !== null && pickNeedsLine(kind) ? validateLine(type, lineInput) : null;

  const goBack = () => {
    setFormError(null);
    if (step === 'confirm') {
      setStep(
        kind !== null && pickNeedsLine(kind)
          ? 'line'
          : kind !== null && pickNeedsTeam(kind)
            ? 'team'
            : 'game',
      );
      return;
    }
    if (step === 'line') {
      setStep(kind !== null && pickNeedsTeam(kind) ? 'team' : 'game');
      return;
    }
    if (step === 'team') {
      setStep('game');
      return;
    }
    if (step === 'game') {
      setStep('type');
      return;
    }
    onDismiss();
  };

  const chooseKind = (next: PickKind) => {
    setKind(next);
    setGame(null);
    setTeamId(null);
    setLineText('');
    setFormError(null);
    setStep('game');
  };

  const chooseGame = (next: ScheduleGame) => {
    setGame(next);
    setTeamId(null);
    setFormError(null);
    if (kind !== null && pickNeedsTeam(kind)) setStep('team');
    else if (kind !== null && pickNeedsLine(kind)) setStep('line');
    else setStep('confirm');
  };

  const chooseTeam = (id: string) => {
    setTeamId(id);
    setFormError(null);
    setStep(kind !== null && pickNeedsLine(kind) ? 'line' : 'confirm');
  };

  const abbreviation =
    game === null || teamId === null
      ? ''
      : teamId === game.home_team_id
        ? game.home_team
        : teamId === game.away_team_id
          ? game.away_team
          : '';

  const confirmLabel =
    type === null
      ? ''
      : formatStakeLabel(
          {
            subject: { type: kind !== null && pickNeedsTeam(kind) ? 'TEAM' : 'GAME', teamId },
            condition: {
              type,
              ...(lineCheck && lineCheck.ok && lineCheck.line !== undefined
                ? { line: lineCheck.line }
                : {}),
            },
          },
          teamId && abbreviation ? [{ teamId, abbreviation }] : [],
        );

  const kindLabel = PICK_KIND_COPY.find((option) => option.kind === kind)?.label ?? null;
  const sideLabel = slipSideLabel({
    kind,
    abbreviation,
    lineText,
    lineOk: lineCheck?.ok === true,
    lineInput,
    totalSide,
  });
  const slipLines = addPickSlipLines({
    kindLabel,
    gameLabel: game ? `${game.away_team} @ ${game.home_team}` : null,
    sideLabel,
  });

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

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + theme.spacing.lg }]}>
        <TextButton label="Back" onPress={goBack} />
        <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.eyebrow}>
          {addPickEyebrow(kind, step)}
        </Text>
      </View>
      <AddPickSlip lines={slipLines} />
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
          ) : games.length === 0 ? (
            <Text style={styles.muted}>No open games this week.</Text>
          ) : (
            <View style={styles.stack}>
              {games.map((row) => (
                <ListRow
                  key={row.game_id}
                  onPress={() => chooseGame(row)}
                  subtitle={gameSubtitle(row)}
                  title={`${row.away_team} @ ${row.home_team}`}
                />
              ))}
            </View>
          )
        ) : null}

        {step === 'team' && game ? (
          <View style={styles.stack}>
            {game.away_team_id ? (
              <ListRow onPress={() => chooseTeam(game.away_team_id ?? '')} title={game.away_team} />
            ) : null}
            {game.home_team_id ? (
              <ListRow onPress={() => chooseTeam(game.home_team_id ?? '')} title={game.home_team} />
            ) : null}
            {!game.away_team_id || !game.home_team_id ? (
              <Text style={styles.error}>This game is missing its teams.</Text>
            ) : null}
          </View>
        ) : null}

        {step === 'line' && kind ? (
          <View style={styles.stack}>
            {kind === 'TOTAL' ? (
              <View style={styles.signRow}>
                <TextButton
                  label="Over"
                  onPress={() => setTotalSide('TOTAL_OVER')}
                  tone={totalSide === 'TOTAL_OVER' ? 'accent' : 'muted'}
                />
                <TextButton
                  label="Under"
                  onPress={() => setTotalSide('TOTAL_UNDER')}
                  tone={totalSide === 'TOTAL_UNDER' ? 'accent' : 'muted'}
                />
              </View>
            ) : (
              <TextButton
                hitArea="padding"
                label={spreadNegative ? '\u2212' : '+'}
                onPress={() => setSpreadNegative((current) => !current)}
              />
            )}
            <TextField
              keyboardType="decimal-pad"
              onChangeText={setLineText}
              placeholder={kind === 'SPREAD' ? '3.5' : '47.5'}
              value={lineText}
            />
            {lineText.trim().length > 0 && lineCheck && !lineCheck.ok ? (
              <Text style={styles.error}>{lineCheck.message}</Text>
            ) : null}
            <PrimaryButton
              disabled={lineCheck === null || !lineCheck.ok}
              label="Continue"
              onPress={() => {
                setFormError(null);
                setStep('confirm');
              }}
            />
          </View>
        ) : null}

        {step === 'confirm' ? (
          <View style={styles.stack}>
            <Text maxFontSizeMultiplier={theme.fontScaleCaps.title} style={styles.confirm}>
              {confirmLabel}
            </Text>
            {game ? (
              <Text style={styles.muted}>
                {`${game.away_team} @ ${game.home_team}${gameSubtitle(game) ? ` · ${gameSubtitle(game)}` : ''}`}
              </Text>
            ) : null}
            {formError ? <Text style={styles.error}>{formError}</Text> : null}
            <PrimaryButton label="Add a pick" loading={saving} onPress={() => void submit()} />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function slipSideLabel(input: {
  kind: PickKind | null;
  abbreviation: string;
  lineText: string;
  lineOk: boolean;
  lineInput: string;
  totalSide: 'TOTAL_OVER' | 'TOTAL_UNDER';
}): string | null {
  if (input.kind === 'TOTAL') {
    const side = input.totalSide === 'TOTAL_OVER' ? 'Over' : 'Under';
    return input.lineText.trim().length > 0 && input.lineOk ? `${side} ${input.lineInput}` : side;
  }
  if (input.abbreviation.length === 0) return null;
  if (input.kind === 'SPREAD' && input.lineText.trim().length > 0 && input.lineOk) {
    return `${input.abbreviation} ${input.lineInput}`;
  }
  return input.abbreviation;
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
  confirm: {
    color: theme.colors.textPrimary,
    fontFamily: theme.type.title.fontFamily,
    fontSize: theme.type.title.size,
    fontWeight: theme.type.title.weight,
  },
  content: {
    gap: theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg2,
  },
  error: {
    color: theme.colors.danger,
    fontSize: theme.type.body.size,
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
  signRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.lg,
  },
  slip: {
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.lg2,
  },
  slipLine: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.body.size,
    lineHeight: theme.type.body.lineHeight,
  },
  stack: {
    gap: theme.spacing.sm,
  },
});
