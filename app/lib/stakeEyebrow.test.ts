import { describe, expect, it } from 'vitest';

import { stakeLineEyebrow } from './stakeEyebrow';

describe('stakeLineEyebrow', () => {
  it.each(['SPREAD', 'TOTAL_OVER', 'TOTAL_UNDER', 'MONEYLINE'])(
    'keeps %s as BET',
    (type) => {
      expect(stakeLineEyebrow(type)).toBe('BET');
    },
  );

  it('labels a survivor stake as POOL', () => {
    expect(stakeLineEyebrow('SURVIVOR')).toBe('POOL');
  });
});
