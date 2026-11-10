/**
 * Narrow types for `react-native-view-shot`, which `app/lib/useShareCard.ts` is the only caller of.
 *
 * Why this exists: 5.x ships raw TypeScript source (`src/*.tsx`) as its types entry, so `tsc`
 * compiles it under our `noUnusedLocals` and fails on the library's own code. `app/tsconfig.json`
 * maps the module to this file so the package source is never type-checked. The runtime import
 * is unaffected (Metro still resolves the real package).
 */
export interface CaptureOptions {
  format?: 'png' | 'jpg' | 'webm' | 'raw';
  quality?: number;
  result?: 'tmpfile' | 'base64' | 'data-uri' | 'zip-base64';
}

export function captureRef(view: unknown, options?: CaptureOptions): Promise<string>;
