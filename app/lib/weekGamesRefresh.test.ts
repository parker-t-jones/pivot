import { describe, expect, it, vi } from 'vitest';

import {
  requestWeekGamesRefresh,
  subscribeWeekGamesRefresh,
  takePendingWeekGamesRefresh,
} from './weekGamesRefresh';

describe('weekGamesRefresh', () => {
  it('notifies a mounted listener immediately', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWeekGamesRefresh(listener);
    requestWeekGamesRefresh();
    expect(listener).toHaveBeenCalledOnce();
    expect(takePendingWeekGamesRefresh()).toBe(false);
    unsubscribe();
  });

  it('holds the refresh until something is listening', () => {
    requestWeekGamesRefresh();
    expect(takePendingWeekGamesRefresh()).toBe(true);
    expect(takePendingWeekGamesRefresh()).toBe(false);
  });
});
