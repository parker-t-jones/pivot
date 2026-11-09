/** What `expo-updates` reports about the JS bundle this launch is running. */
export interface RunningUpdate {
  isEnabled: boolean;
  isEmbeddedLaunch: boolean;
  updateId: string | null;
  channel: string | null;
}

/**
 * Settings → About line that says which bundle this device runs, so a support thread or a
 * rollback check (docs/EAS-UPDATE-RUNBOOK.md) can match it to an EAS update group. Null when
 * there is nothing to say: web, development builds, Expo Go.
 */
export function updateLabel(update: RunningUpdate | null): string | null {
  if (!update || !update.isEnabled) return null;
  if (update.isEmbeddedLaunch || !update.updateId) {
    return 'Running the version that shipped with this build.';
  }
  const shortId = update.updateId.slice(0, 8);
  return update.channel
    ? `Running update ${shortId} from the ${update.channel} channel.`
    : `Running update ${shortId}.`;
}
