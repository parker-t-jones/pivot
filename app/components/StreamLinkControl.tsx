import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useGameLinks } from '../contexts/GameLinksContext';
import { ApiRequestError } from '../lib/apiClient';
import { fonts } from '../lib/fonts';
import { theme } from '../lib/theme';
import { webPressState } from '../lib/webPress';
import { PrimaryButton } from './PrimaryButton';
import { TextButton } from './TextButton';
import { TextField } from './TextField';

interface StreamLinkControlProps {
  gameId: string;
  away: string;
  home: string;
}

/** Chip text drops a leading www. The stored host stays the full hostname. */
export function streamLinkChipLabel(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : host;
}

/**
 * Web-only add/edit for one game's saved stream URL. Hidden when the API has no
 * `/game-links` routes (`available` is false) and on iOS.
 */
export function StreamLinkControl({ gameId, away, home }: StreamLinkControlProps) {
  const { available, get, save, remove } = useGameLinks();
  const link = get(gameId);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const matchup = `${away} @ ${home}`;

  useEffect(() => {
    if (!open || Platform.OS !== 'web') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) setOpen(false);
    };
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, [busy, open]);

  if (Platform.OS !== 'web' || !available) return null;

  function openEditor() {
    setDraft(link?.url ?? '');
    setError(null);
    setOpen(true);
  }

  function close() {
    if (busy) return;
    setOpen(false);
  }

  async function onSave() {
    setBusy(true);
    setError(null);
    try {
      await save(gameId, draft);
      setOpen(false);
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.status === 400
          ? err.message
          : 'Could not save that link.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    setBusy(true);
    setError(null);
    try {
      await remove(gameId);
      setOpen(false);
    } catch {
      setError('Could not remove that link.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      {link ? (
        <Pressable
          accessibilityLabel={`Edit stream link for ${matchup}`}
          accessibilityRole="button"
          onPress={openEditor}
          style={styles.chip}
        >
          <Text numberOfLines={1} style={styles.chipText}>
            {streamLinkChipLabel(link.host)}
          </Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityLabel={`Add stream link for ${matchup}`}
          accessibilityRole="button"
          onPress={openEditor}
          style={(state) => {
            const { hovered, pressed } = webPressState(state);
            return [styles.iconButton, (hovered || pressed) && styles.iconButtonHot];
          }}
        >
          <LinkMark />
        </Pressable>
      )}
      <Modal animationType="fade" onRequestClose={close} transparent visible={open}>
        <View style={styles.backdrop}>
          <Pressable
            accessibilityLabel="Dismiss"
            accessibilityRole="button"
            onPress={close}
            style={StyleSheet.absoluteFill}
          />
          <View accessibilityViewIsModal style={styles.card}>
            <Text style={styles.title}>{`Stream link · ${matchup}`}</Text>
            <TextField
              accessibilityLabel="Stream URL"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              onChangeText={setDraft}
              placeholder="Paste the game's stream URL (https://…)"
              value={draft}
            />
            <Text style={styles.helper}>Switch will open this link instead of searching.</Text>
            {error !== null ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.actions}>
              {link ? (
                <TextButton
                  disabled={busy}
                  label="Remove link"
                  onPress={() => void onRemove()}
                  tone="danger"
                />
              ) : (
                <View />
              )}
              <PrimaryButton
                disabled={busy}
                label="Save"
                loading={busy}
                onPress={() => void onSave()}
                style={styles.save}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function LinkMark() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.mark}
    >
      <View style={[styles.loop, styles.loopBack]} />
      <View style={[styles.loop, styles.loopFront]} />
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.spacing.lg,
  },
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
  },
  card: {
    backgroundColor: theme.colors.surface,
    zIndex: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.lg,
    borderWidth: theme.effects.panelBorderWidth,
    maxWidth: 380,
    padding: theme.spacing.lg2,
    width: '100%',
  },
  chip: {
    backgroundColor: theme.colors.accentMuted,
    borderColor: theme.colors.accentBorder,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    flexShrink: 1,
    maxWidth: 140,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
  },
  chipText: {
    color: theme.colors.accent,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.eyebrow.size,
  },
  error: {
    color: theme.colors.danger,
    fontSize: theme.type.caption.size,
    lineHeight: theme.type.caption.lineHeight,
    marginTop: theme.spacing.sm,
  },
  helper: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.caption.size,
    lineHeight: theme.type.caption.lineHeight,
    marginTop: theme.spacing.sm,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: theme.radii.sm,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  iconButtonHot: {
    backgroundColor: theme.colors.accentMuted,
  },
  loop: {
    borderColor: theme.colors.textSecondary,
    borderRadius: 3,
    borderWidth: 1.5,
    height: 6,
    position: 'absolute',
    width: 9,
  },
  loopBack: {
    left: 0,
    top: 1,
    transform: [{ rotate: '-40deg' }],
  },
  loopFront: {
    bottom: 1,
    right: 0,
    transform: [{ rotate: '-40deg' }],
  },
  mark: {
    height: 14,
    width: 14,
  },
  save: {
    minWidth: 96,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.smallStrong.size,
    fontWeight: theme.type.smallStrong.weight,
    marginBottom: theme.spacing.md,
  },
});
