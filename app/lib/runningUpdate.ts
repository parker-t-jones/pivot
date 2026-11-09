import * as Updates from 'expo-updates';

import type { RunningUpdate } from './updateLabel';

export function runningUpdate(): RunningUpdate | null {
  return {
    isEnabled: Updates.isEnabled,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    updateId: Updates.updateId,
    channel: Updates.channel,
  };
}
