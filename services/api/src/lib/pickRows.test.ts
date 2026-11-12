import { describe, expect, it } from 'vitest';
import { parseCondition } from './pickRows.js';

describe('player stat row validation', () => {
  it.each(['STAT_OVER', 'STAT_UNDER'])(
    'accepts RUSH_REC_YDS for %s and rejects unknown keys',
    (type) => {
      const condition = { type, stat: 'RUSH_REC_YDS', line: 46.5 };
      expect(parseCondition(condition)).toEqual(condition);
      expect(parseCondition({ ...condition, stat: 'UNKNOWN_STAT' })).toBeNull();
    },
  );
});
