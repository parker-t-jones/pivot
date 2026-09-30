/** Fraction of the following chip kept in view when aligning a chip that isn't already visible. */
const PEEK_FRACTION = 0.3;

const VISIBLE_EPSILON = 0.5;

/**
 * Chip width for a scrolling league row. `innerWidth` is the visible lane in
 * pixels (not a percentage of the scroll content): two chips and two gaps fill
 * it, and 30% of the next chip peeks past them.
 */
export function leagueChipWidth(innerWidth: number, gap: number): number {
  return (innerWidth - 2 * gap) / 2.3;
}

export interface LeagueChipScrollInput {
  leagueCount: number;
  selectedIndex: number;
  chipWidth: number;
  gap: number;
  viewportWidth: number;
  currentOffset: number;
  /** Space before the first chip. The lane used for `leagueChipWidth` excludes this. */
  leadingInset?: number;
  trailingInset?: number;
}

/**
 * Scroll offset that brings the selected chip fully on screen.
 * Already fully visible → `currentOffset` (no movement).
 * Otherwise the smallest move that also keeps ~30% of the next chip visible,
 * clamped to `[0, contentWidth − viewportWidth]`.
 */
export function leagueChipScrollOffset({
  leagueCount,
  selectedIndex,
  chipWidth,
  gap,
  viewportWidth,
  currentOffset,
  leadingInset = 0,
  trailingInset = 0,
}: LeagueChipScrollInput): number {
  if (leagueCount <= 0 || chipWidth <= 0 || viewportWidth <= 0) return 0;

  const index = Math.min(Math.max(selectedIndex, 0), leagueCount - 1);
  const origin = (chipIndex: number) => leadingInset + chipIndex * (chipWidth + gap);
  const selectedStart = origin(index);
  const selectedEnd = selectedStart + chipWidth;
  const contentWidth =
    leadingInset + leagueCount * chipWidth + (leagueCount - 1) * gap + trailingInset;
  const maxOffset = Math.max(0, contentWidth - viewportWidth);
  const viewEnd = currentOffset + viewportWidth;
  const fullyVisible =
    selectedStart >= currentOffset - VISIBLE_EPSILON && selectedEnd <= viewEnd + VISIBLE_EPSILON;
  if (fullyVisible) return currentOffset;

  let minOffset = selectedEnd - viewportWidth;
  if (index + 1 < leagueCount) {
    const peekEnd = origin(index + 1) + chipWidth * PEEK_FRACTION;
    minOffset = Math.max(minOffset, peekEnd - viewportWidth);
  }
  const maxAligned = selectedStart;
  const low = Math.min(minOffset, maxAligned);
  const high = Math.max(minOffset, maxAligned);
  const nearest = currentOffset < low ? low : currentOffset > high ? high : currentOffset;
  return Math.min(maxOffset, Math.max(0, nearest));
}
