import { StyleSheet, Text, View } from 'react-native';

import { PICK_KIND_COPY, pickKindAccess, type PickKind } from '../lib/addPickFlow';
import { theme } from '../lib/theme';
import { ListRow } from './ListRow';

interface Allowance {
  isPro: boolean;
  freeLeft: number | null;
}

export function AddPickTypeStep({
  allowance,
  onChoose,
  onUpgrade,
  disabled = false,
}: {
  allowance: Allowance | null;
  onChoose: (kind: PickKind) => void;
  onUpgrade: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.stack}>
      {allowance != null && !allowance.isPro && allowance.freeLeft != null ? (
        <Text style={styles.count}>{`${allowance.freeLeft} free bets left this week`}</Text>
      ) : null}
      {PICK_KIND_COPY.map((option) => {
        const access = allowance == null ? 'open' : pickKindAccess(option.kind, allowance);
        const locked = access === 'upgrade';
        return (
          <ListRow
            disabled={disabled}
            key={option.kind}
            onPress={disabled ? () => undefined : locked ? onUpgrade : () => onChoose(option.kind)}
            style={disabled || locked ? styles.locked : undefined}
            subtitle={locked ? 'No free bets left · Upgrade' : option.explainer}
            title={option.label}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  count: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
    lineHeight: theme.type.body.lineHeight,
  },
  locked: {
    opacity: theme.opacity.disabled,
  },
  stack: {
    gap: theme.spacing.sm,
  },
});
