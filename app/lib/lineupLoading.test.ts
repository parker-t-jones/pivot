import { describe, expect, it } from 'vitest';

import { lineupLoadingMessage, showFullLoading } from './lineupLoading';

describe('showFullLoading', () => {
  it('shows the full loader only before any lineup exists', () => {
    expect(showFullLoading(false, true)).toBe(true);
    expect(showFullLoading(false, false)).toBe(false);
  });

  it('keeps the current screen while a refocus refetches', () => {
    expect(showFullLoading(true, true)).toBe(false);
    expect(showFullLoading(true, false)).toBe(false);
  });
});

describe('lineupLoadingMessage', () => {
  it('follows the tab name', () => {
    expect(lineupLoadingMessage(true)).toBe('Loading watchlist…');
    expect(lineupLoadingMessage(false)).toBe('Loading lineup…');
  });
});
