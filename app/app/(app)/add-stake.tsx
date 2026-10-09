import { networkLabelFromAirings } from '@pivot/shared/broadcast';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState } from '../../components/ErrorState';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { PrimaryButton } from '../../components/PrimaryButton';
import { TextButton } from '../../components/TextButton';
import { TextField } from '../../components/TextField';
import { fetchNflState } from '../../lib/nflState';
import { fetchGamesWeek, type ScheduleGame } from '../../lib/schedule';
import {
  buildStakeRequest,
  formatStakeLabel,
  validateLine,
  type ManualStakeType,
} from '../../lib/stakes';
import { createStake, stakeRequestError } from '../../lib/stakesClient';
import { theme } from '../../lib/theme';

type Kind = 'SPREAD' | 'TOTAL' | 'MONEYLINE' | 'SURVIVOR';
type Step = 'type' | 'game' | 'team' | 'line' | 'confirm';

const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'SPREAD', label: 'Spread' },
  { kind: 'TOTAL', label: 'Total' },
  { kind: 'MONEYLINE', label: 'Moneyline' },
  { kind: 'SURVIVOR', label: 'Survivor' },
];

function stakeType(kind: Kind, totalSide: 'TOTAL_OVER' | 'TOTAL_UNDER'): ManualStakeType {
  return kind === 'TOTAL' ? totalSide : kind;
}

function needsTeam(kind: Kind): boolean {
  return kind !== 'TOTAL';
}

function needsLine(kind: Kind): boolean {
  return kind === 'SPREAD' || kind === 'TOTAL';
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

export default function AddStakeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('type');
  const [kind, setKind] = useState<Kind | null>(null);
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

  const loadGames = useCallback(async () => {
    setLoadingGames(true);
    setGamesError(null);
    try {
      const nfl = await fetchNflState();
      const slate = await fetchGamesWeek(nfl.week);
      setGames(slate.games.filter((row) => row.status !== 'final'));
    } catch {
      setGamesError('Could not load this week’s games.');
    } finally {
      setLoadingGames(false);
    }
  }, []);

  useEffect(() => {
    void loadGames();
  }, [loadGames]);

  const type = kind === null ? null : stakeType(kind, totalSide);
  const lineInput =
    kind === 'SPREAD' ? `${spreadNegative ? '-' : '+'}${lineText.trim()}` : lineText.trim();
  const lineCheck =
    type !== null && needsLine(kind ?? 'SPREAD') ? validateLine(type, lineInput) : null;

  const goBack = () => {
    setFormError(null);
    if (step === 'confirm') {
      setStep(
        kind !== null && needsLine(kind)
          ? 'line'
          : kind !== null && needsTeam(kind)
            ? 'team'
            : 'game',
      );
      return;
    }
    if (step === 'line') {
      setStep(kind !== null && needsTeam(kind) ? 'team' : 'game');
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
    if (router.canGoBack()) router.back();
    else router.replace('/(app)/(tabs)/lineup');
  };

  const chooseKind = (next: Kind) => {
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
    if (kind !== null && needsTeam(kind)) setStep('team');
    else if (kind !== null && needsLine(kind)) setStep('line');
    else setStep('confirm');
  };

  const chooseTeam = (id: string) => {
    setTeamId(id);
    setFormError(null);
    setStep(kind !== null && needsLine(kind) ? 'line' : 'confirm');
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
            subject: { type: needsTeam(kind ?? 'SPREAD') ? 'TEAM' : 'GAME', teamId },
            condition: {
              type,
              ...(lineCheck && lineCheck.ok && lineCheck.line !== undefined
                ? { line: lineCheck.line }
                : {}),
            },
          },
          teamId && abbreviation ? [{ teamId, abbreviation }] : [],
        );

  const submit = async () => {
    if (type === null || game === null) return;
    if (needsTeam(kind ?? 'SPREAD') && (teamId === null || teamId.length === 0)) {
      setFormError('Pick a team in that game.');
      return;
    }
    if (needsLine(kind ?? 'SPREAD')) {
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
      if (router.canGoBack()) router.back();
      else router.replace('/(app)/(tabs)/lineup');
    } catch (error) {
      setFormError(stakeRequestError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + theme.spacing.lg }]}>
        <TextButton label="Back" onPress={goBack} />
        <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.eyebrow}>
          ADD A STAKE
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + theme.spacing.huge },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {step === 'type' ? (
          <View style={styles.stack}>
            {KINDS.map((option) => (
              <ListRow
                key={option.kind}
                onPress={() => chooseKind(option.kind)}
                title={option.label}
              />
            ))}
          </View>
        ) : null}

        {step === 'game' ? (
          loadingGames ? (
            <LoadingState message="Loading games…" />
          ) : gamesError ? (
            <ErrorState message={gamesError} onRetry={() => void loadGames()} />
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
            <PrimaryButton label="Add stake" loading={saving} onPress={() => void submit()} />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
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
  signRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.lg,
  },
  stack: {
    gap: theme.spacing.sm,
  },
});
