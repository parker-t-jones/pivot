import { describe, expect, it } from 'vitest';
import { formatBackfillReport, parseBackfillArgs } from './backfill-stakes.js';

describe('backfill-stakes', () => {
  it('dry-runs unless --apply is passed', () => {
    expect(parseBackfillArgs([])).toEqual({ apply: false });
    expect(parseBackfillArgs(['--dry-run'])).toEqual({ apply: false });
    expect(parseBackfillArgs(['--apply'])).toEqual({ apply: true });
  });

  it('prints one line per user and a total', () => {
    const report = formatBackfillReport(
      [
        { userId: 'user-b', stakes: 2, insert: 2, update: 0, delete: 0 },
        { userId: 'user-a', stakes: 1, insert: 0, update: 0, delete: 1 },
      ],
      true,
    );
    expect(report).toBe(
      [
        '[stakes] dry-run user=user-a stakes=1 insert=0 update=0 delete=1',
        '[stakes] dry-run user=user-b stakes=2 insert=2 update=0 delete=0',
        '[stakes] dry-run total users=2 stakes=3 insert=2 update=0 delete=1',
      ].join('\n'),
    );
  });
});
