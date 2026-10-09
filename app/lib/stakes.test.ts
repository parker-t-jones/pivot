import { describe, expect, it } from 'vitest';
import {
  buildStakeRequest,
  formatStakeLabel,
  stakeErrorCopy,
  validateLine,
  type StakeLabelSource,
  type StakeTeam,
} from './stakes';

const DET: StakeTeam = { teamId: 'det', abbreviation: 'DET' };

function teamStake(type: string, line?: number): StakeLabelSource {
  return {
    subject: { type: 'TEAM', teamId: 'det' },
    condition: line === undefined ? { type } : { type, line },
  };
}

describe('formatStakeLabel', () => {
  const teams = [DET];

  it('formats each manual stake', () => {
    expect(formatStakeLabel(teamStake('SPREAD', -3.5), teams)).toBe('DET \u22123.5');
    expect(formatStakeLabel(teamStake('SPREAD', 7), teams)).toBe('DET +7');
    expect(
      formatStakeLabel(
        { subject: { type: 'GAME' }, condition: { type: 'TOTAL_OVER', line: 47.5 } },
        teams,
      ),
    ).toBe('Over 47.5');
    expect(
      formatStakeLabel(
        { subject: { type: 'GAME' }, condition: { type: 'TOTAL_UNDER', line: 47.5 } },
        teams,
      ),
    ).toBe('Under 47.5');
    expect(formatStakeLabel(teamStake('MONEYLINE'), teams)).toBe('DET ML');
    expect(formatStakeLabel(teamStake('SURVIVOR'), teams)).toBe('Survivor · DET');
  });
});

describe('validateLine', () => {
  it('mirrors the spread window', () => {
    expect(validateLine('SPREAD', '-3.5')).toEqual({ ok: true, line: -3.5 });
    expect(validateLine('SPREAD', '\u22123.5')).toEqual({ ok: true, line: -3.5 });
    expect(validateLine('SPREAD', '7')).toEqual({ ok: true, line: 7 });
    expect(validateLine('SPREAD', '50')).toEqual({ ok: true, line: 50 });
    expect(validateLine('SPREAD', '-50')).toEqual({ ok: true, line: -50 });
    expect(validateLine('SPREAD', '0')).toEqual({ ok: true, line: 0 });
    expect(validateLine('SPREAD', '0.25').ok).toBe(false);
    expect(validateLine('SPREAD', '50.5').ok).toBe(false);
    expect(validateLine('SPREAD', '-50.5').ok).toBe(false);
    expect(validateLine('SPREAD', '').ok).toBe(false);
    expect(validateLine('SPREAD', '-').ok).toBe(false);
    expect(validateLine('SPREAD', '+').ok).toBe(false);
  });

  it('mirrors the total window', () => {
    expect(validateLine('TOTAL_OVER', '47.5')).toEqual({ ok: true, line: 47.5 });
    expect(validateLine('TOTAL_UNDER', '10')).toEqual({ ok: true, line: 10 });
    expect(validateLine('TOTAL_OVER', '100')).toEqual({ ok: true, line: 100 });
    expect(validateLine('TOTAL_OVER', '9.5').ok).toBe(false);
    expect(validateLine('TOTAL_UNDER', '100.5').ok).toBe(false);
    expect(validateLine('TOTAL_OVER', '47.25').ok).toBe(false);
  });

  it('rejects a line on moneyline and survivor', () => {
    expect(validateLine('MONEYLINE', '')).toEqual({ ok: true });
    expect(validateLine('SURVIVOR', '')).toEqual({ ok: true });
    expect(validateLine('MONEYLINE', '-3').ok).toBe(false);
    expect(validateLine('SURVIVOR', '0').ok).toBe(false);
  });
});

describe('buildStakeRequest', () => {
  it('sends a team and line only when that type uses them', () => {
    expect(buildStakeRequest({ type: 'SPREAD', gameId: 'g1', teamId: 'det', line: -3.5 })).toEqual({
      type: 'SPREAD',
      gameId: 'g1',
      teamId: 'det',
      line: -3.5,
    });
    expect(
      buildStakeRequest({ type: 'TOTAL_OVER', gameId: 'g1', teamId: 'det', line: 47.5 }),
    ).toEqual({ type: 'TOTAL_OVER', gameId: 'g1', line: 47.5 });
    expect(buildStakeRequest({ type: 'MONEYLINE', gameId: 'g1', teamId: 'det', line: 3 })).toEqual({
      type: 'MONEYLINE',
      gameId: 'g1',
      teamId: 'det',
    });
    expect(buildStakeRequest({ type: 'SURVIVOR', gameId: 'g1', teamId: 'det' })).toEqual({
      type: 'SURVIVOR',
      gameId: 'g1',
      teamId: 'det',
    });
  });
});

describe('stakeErrorCopy', () => {
  it('maps each server code', () => {
    expect(stakeErrorCopy('stake_game_invalid')).toMatch(/not open/);
    expect(stakeErrorCopy('stake_team_invalid')).toMatch(/team/);
    expect(stakeErrorCopy('stake_line_invalid')).toMatch(/line/);
    expect(stakeErrorCopy('survivor_pick_exists')).toMatch(/survivor/i);
    expect(stakeErrorCopy('stake_duplicate')).toMatch(/already/);
    expect(stakeErrorCopy('stake_managed_by_sync')).toMatch(/sync/);
    expect(stakeErrorCopy('other')).toMatch(/Could not/);
  });
});
