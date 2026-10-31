import { useState } from 'react';
import { View } from 'react-native';

import type { GameBroadcast } from '../lib/gameDisplay';
import { TextButton } from './TextButton';

/**
 * Later resolver matches, collapsed until the viewer asks. The primary button stays separate.
 */
export function OtherWaysToWatch({
  alternates,
  onOpen,
}: {
  alternates: readonly GameBroadcast[];
  onOpen: (broadcast: GameBroadcast) => void;
}) {
  const [open, setOpen] = useState(false);
  if (alternates.length === 0) return null;

  return (
    <View>
      <TextButton
        label="Other ways to watch"
        onPress={() => setOpen((value) => !value)}
        size="small"
        tone="muted"
      />
      {open
        ? alternates.map((alternate) => (
            <TextButton
              key={alternate.deep_link_url}
              label={alternate.label ?? alternate.deep_link_url}
              onPress={() => onOpen(alternate)}
              size="small"
            />
          ))
        : null}
    </View>
  );
}
