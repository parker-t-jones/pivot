import { useCallback, useState } from 'react';
import type { RefObject } from 'react';
import type { View } from 'react-native';

import type { ShareContent } from './shareCard';
import { theme } from './theme';

export interface ShareCardResult {
  ok: boolean;
  reason?: string;
}

export interface UseShareCard {
  sharing: boolean;
  share: (
    viewRef: RefObject<View | null>,
    content: ShareContent,
    dialogTitle: string,
  ) => Promise<ShareCardResult>;
}

const WIDTH = 720;
const PADDING = 48;
const ROW_GAP = 56;

/** Draws the card straight onto a canvas from `content` — no screenshot of the live DOM (which
 * has buttons the shared image shouldn't show), and no extra web dependency. */
function drawCard(ctx: CanvasRenderingContext2D, content: ShareContent): number {
  let y = PADDING;
  ctx.fillStyle = theme.colors.textPrimary;
  ctx.font = '600 32px sans-serif';
  ctx.fillText(content.title, PADDING, y + 32);
  y += 48;
  if (content.subtitle) {
    ctx.fillStyle = theme.colors.brass;
    ctx.font = '700 15px monospace';
    ctx.fillText(content.subtitle.toUpperCase(), PADDING, y);
    y += 40;
  }
  for (const row of content.rows) {
    ctx.fillStyle = theme.colors.brass;
    ctx.font = '700 13px monospace';
    ctx.fillText(row.label.toUpperCase(), PADDING, y);
    ctx.fillStyle = theme.colors.textPrimary;
    ctx.font = '500 20px sans-serif';
    ctx.fillText(row.value, PADDING, y + 26);
    if (row.note) {
      ctx.fillStyle = theme.colors.accent;
      ctx.font = '400 14px sans-serif';
      ctx.fillText(row.note, PADDING, y + 48);
    }
    y += ROW_GAP;
  }
  ctx.fillStyle = theme.colors.brass;
  ctx.font = '700 13px monospace';
  ctx.fillText(content.footer, PADDING, y + 24);
  return y + PADDING + 24;
}

function renderCanvas(content: ShareContent): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  // A first pass at a generous height gets the real content height from `drawCard`, then we
  // redraw at the right size — simpler than measuring every line ahead of time.
  canvas.height = 2000;
  const measure = canvas.getContext('2d');
  const height = measure ? drawCard(measure, content) : 600;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = theme.colors.background;
    ctx.fillRect(0, 0, WIDTH, height);
    drawCard(ctx, content);
  }
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

function downloadBlob(blob: Blob, filenameBase: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filenameBase}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

type ShareCapableNavigator = Navigator & {
  canShare?: (data?: { files?: File[] }) => boolean;
  share?: (data: { files?: File[]; title?: string }) => Promise<void>;
};

/**
 * Web: the Web Share API with the image file where the browser supports sharing files
 * (`navigator.canShare({ files })`), otherwise a plain download — chosen over the Web Share
 * API's text-only form because a download the user can attach anywhere is a closer match to
 * "share this image" than a link with no image at all.
 */
export function useShareCard(): UseShareCard {
  const [sharing, setSharing] = useState(false);

  const share = useCallback(
    // Native captures `viewRef`; the web fallback draws `content` onto a canvas instead, so this
    // parameter is unused here but kept so both platform files export the same hook shape.
    async (
      _viewRef: RefObject<View | null>,
      content: ShareContent,
      dialogTitle: string,
    ): Promise<ShareCardResult> => {
      setSharing(true);
      try {
        const canvas = renderCanvas(content);
        const blob = await canvasToBlob(canvas);
        if (!blob) return { ok: false, reason: 'no-blob' };
        const filenameBase = content.kind === 'week' ? 'pivot-week-card' : 'pivot-pick-card';
        const nav = navigator as ShareCapableNavigator;
        const file = new File([blob], `${filenameBase}.png`, { type: 'image/png' });
        if (nav.canShare?.({ files: [file] }) && nav.share) {
          try {
            await nav.share({ files: [file], title: dialogTitle });
            return { ok: true };
          } catch (error) {
            // The user closing the share sheet throws AbortError — not a failure to fall back on.
            if (error instanceof DOMException && error.name === 'AbortError') return { ok: true };
            downloadBlob(blob, filenameBase);
            return { ok: true };
          }
        }
        downloadBlob(blob, filenameBase);
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
