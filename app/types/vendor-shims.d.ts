/**
 * Ambient module declarations for native dependencies added by issue #48
 * (`expo-sharing`, `react-native-view-shot`) that this build environment could not fetch:
 * the recon/build sandbox has no npm registry access (outbound HTTPS to registry.npmjs.org
 * returns a 403 from the egress proxy), so `pnpm install` could not pull them in. These shims
 * cover only the calls `app/lib/useShareCard.ts` actually makes, so `pnpm typecheck` can run
 * without the real packages installed.
 *
 * Action needed after merge: run `pnpm install` (and `npx expo install --check` from `app/` to
 * confirm the pinned versions in `app/package.json` are the right ones for the installed Expo
 * SDK), then delete this file — the packages ship their own, more complete types.
 */
declare module 'expo-sharing' {
  export function isAvailableAsync(): Promise<boolean>;
  export function shareAsync(
    url: string,
    options?: { dialogTitle?: string; mimeType?: string; UTI?: string },
  ): Promise<void>;
}
