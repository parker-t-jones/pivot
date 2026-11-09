import { describe, expect, it } from 'vitest';

import {
  fieldGoalReadout,
  segmentSpreadReadout,
  segmentTotalReadout,
  statReadout,
  teamTotalReadout,
} from './pickReadout';

describe('prop readouts', () => {
  it('reads an over as the number needed', () => {
    expect(statReadout('Kittle', 'over', 60.5, 'receiving yards')).toBe(
      'Kittle needs 61 or more receiving yards',
    );
  });

  it('reads an under as the most allowed, and zero plainly', () => {
    expect(statReadout('Mahomes', 'under', 1.5, 'interceptions thrown')).toBe(
      'Mahomes needs 1 or fewer interceptions thrown',
    );
    expect(statReadout('Mahomes', 'under', 0.5, 'interceptions thrown')).toBe(
      'Mahomes needs to finish with 0 interceptions thrown',
    );
  });

  it('names a whole-number line as a refunded tie', () => {
    expect(statReadout('Kittle', 'over', 5, 'receptions')).toBe(
      'Kittle needs 6 or more receptions. Exactly 5 is a tie, and the pick is refunded.',
    );
  });
});

describe('quarter and half readouts', () => {
  it('says overtime counts in the 2nd half and not in the 4th quarter', () => {
    expect(teamTotalReadout('49ers', 'over', 10.5, 'H2')).toBe(
      '49ers must score 11 or more points in the 2nd half. Overtime counts.',
    );
    expect(segmentTotalReadout('over', 9.5, 'Q4')).toBe(
      "Combined score in the 4th quarter must be 10 or more. Overtime doesn't count.",
    );
    expect(teamTotalReadout('49ers', 'under', 0.5, 'Q1')).toBe(
      '49ers must score 0 points in the 1st quarter',
    );
  });

  it('reads a quarter spread from the underdog side', () => {
    expect(segmentSpreadReadout('Seahawks', 'underdog', 3.5, 'Q2')).toBe(
      'Seahawks must lose the 2nd quarter by 3 or less, or win it',
    );
  });

  it('reads field goals for both teams or one', () => {
    expect(fieldGoalReadout(null, 'under', 0.5, 'Q3')).toBe(
      'The two teams must make no field goals in the 3rd quarter',
    );
    expect(fieldGoalReadout('Ravens', 'over', 2, null)).toBe(
      'Ravens must make 3 or more field goals. Exactly 2 is a tie, and the pick is refunded.',
    );
  });
});
