export type LivePreviewState = 'halftime' | 'active' | 'redzone' | 'endq';

/** Production stand-in. The real preview and the Monday-night fixture are not in this graph. */
export function LiveCardPreview(_props: { initial?: LivePreviewState }) {
  return null;
}
