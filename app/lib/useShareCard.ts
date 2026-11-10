import { useCallback, useState } from 'react';
import type { RefObject } from 'react';
import type { View } from 'react-native';

import type { ShareContent } from './shareCard';

export interface ShareCardResult {
  ok: boolean;
  reason?: string;
}

export interface UseShareCard {
  sharing: boolean;
  /** Captures the view at `viewRef` (an offscreen `ShareableCard`) and hands it to the share
   * sheet / web fallback. `content` names the file; `dialogTitle` is the only text the OS share
   * sheet itself shows. */
  share: (
    viewRef: RefObject<View | null>,
    content: ShareContent,
    dialogTitle: string,
  ) => Promise<ShareCardResult>;
}

/**
 * Native: `react-native-view-shot` captures the offscreen `ShareableCard` to a PNG, then
 * `expo-sharing` hands that file to the OS share sheet. Both are loaded on tap, so screens that
 * never share a card don't pull the native modules in.
 */
export function useShareCard(): UseShareCard {
  const [sharing, setSharing] = useState(false);

  const share = useCallback(
    // `content` only matters for the web fallback's canvas draw (`useShareCard.web.ts`); native
    // captures the live `viewRef` instead, so this signature keeps the two call sites identical.
    async (
      viewRef: RefObject<View | null>,
      _content: ShareContent,
      dialogTitle: string,
    ): Promise<ShareCardResult> => {
      const node = viewRef.current;
      if (!node) return { ok: false, reason: 'not-ready' };
      setSharing(true);
      try {
        const { captureRef } = await import('react-native-view-shot');
        const Sharing = await import('expo-sharing');
        const uri = await captureRef(node, { format: 'png', quality: 1 });
        const available = await Sharing.isAvailableAsync();
        if (!available) return { ok: false, reason: 'unavailable' };
        await Sharing.shareAsync(uri, { dialogTitle, mimeType: 'image/png' });
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : 'unknown' };
      } finally {
        setSharing(false);
      }
    },
    [],
  );

  return { sharing, share };
}
