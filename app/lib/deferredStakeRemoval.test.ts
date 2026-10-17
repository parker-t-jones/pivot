import { describe, expect, it } from 'vitest';

import {
  beginRemoval,
  EMPTY_REMOVAL,
  expireRemoval,
  failRemoval,
  undoRemoval,
} from './deferredStakeRemoval';

describe('deferred stake removal', () => {
  it('undo cancels the delete and brings the row back', () => {
    const started = beginRemoval(EMPTY_REMOVAL, 'a');
    expect(started.commitId).toBeNull();
    expect(started.state.hiddenIds).toEqual(['a']);
    const undone = undoRemoval(started.state);
    expect(undone.commitId).toBeNull();
    expect(undone.state).toEqual(EMPTY_REMOVAL);
  });

  it('expiry commits the pending row', () => {
    const started = beginRemoval(EMPTY_REMOVAL, 'a');
    const expired = expireRemoval(started.state);
    expect(expired.commitId).toBe('a');
    expect(expired.state.pendingId).toBeNull();
    expect(expired.state.hiddenIds).toEqual(['a']);
  });

  it('removing a second row commits the first', () => {
    const first = beginRemoval(EMPTY_REMOVAL, 'a');
    const second = beginRemoval(first.state, 'b');
    expect(second.commitId).toBe('a');
    expect(second.state.pendingId).toBe('b');
    expect(second.state.hiddenIds).toEqual(['a', 'b']);
  });

  it('a failed delete restores that row', () => {
    const started = beginRemoval(EMPTY_REMOVAL, 'a');
    const expired = expireRemoval(started.state);
    expect(failRemoval(expired.state, 'a')).toEqual(EMPTY_REMOVAL);
  });
});
