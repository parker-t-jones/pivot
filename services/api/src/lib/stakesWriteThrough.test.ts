import { describe, expect, it, vi } from 'vitest';
import {
  deleteLeagueStakes,
  formatStakesWriteFailure,
  stakesWriteEnabled,
  writeThroughLeagueStakes,
} from './stakesWriteThrough.js';

describe('stakes write-through gate', () => {
  it('is off unless STAKES_WRITE=1', () => {
    expect(stakesWriteEnabled({})).toBe(false);
    expect(stakesWriteEnabled({ STAKES_WRITE: '0' })).toBe(false);
    expect(stakesWriteEnabled({ STAKES_WRITE: '1' })).toBe(true);
  });

  it('does not touch the database when the flag is off', async () => {
    let called = false;
    const supabase = {
      from() {
        called = true;
        throw new Error('should not be called');
      },
    };
    await writeThroughLeagueStakes(supabase as never, 'league-1', 5, {});
    await deleteLeagueStakes(supabase as never, 'user-1', 'league-1', {});
    expect(called).toBe(false);
  });

  it('logs and does not throw when the stake write fails', async () => {
    const supabase = {
      from() {
        throw new Error('db down');
      },
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      writeThroughLeagueStakes(supabase as never, 'league-1234', 5, { STAKES_WRITE: '1' }),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      formatStakesWriteFailure('', 'league-1234', new Error('db down')),
    );
    expect(String(spy.mock.calls[0]?.[0])).toBe(
      '[stakes] write-through failed user= ref=league-1234 err=db down',
    );
    spy.mockRestore();
  });
});
