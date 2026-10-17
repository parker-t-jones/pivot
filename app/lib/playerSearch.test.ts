import { describe, expect, it } from 'vitest';

import { queryAfterSearchReset, searchClearVisible } from './playerSearch';

describe('player search field', () => {
  it('hides the clear control when the query is empty and shows it otherwise', () => {
    expect(searchClearVisible('')).toBe(false);
    expect(searchClearVisible('a')).toBe(true);
    expect(searchClearVisible('  ')).toBe(true);
  });

  it('clears the query after a player is selected', () => {
    expect(queryAfterSearchReset()).toBe('');
    expect(searchClearVisible(queryAfterSearchReset())).toBe(false);
  });
});
