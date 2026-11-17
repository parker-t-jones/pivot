import { describe, expect, it } from 'vitest';
import { carryManualLineupForward, markManualLineupWeek } from './manualLineupCarry.js';
import { MemSupabase, type Row } from './memSupabase.test-helper.js';
import type { SupabaseServiceClient } from './supabase.js';

const LEAGUE = '11111111-1111-4111-8111-111111111111';
const OTHER_LEAGUE = '22222222-2222-4222-8222-222222222222';
const QB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const RB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const WR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';

function slot(week: number, playerId: string, position: string, isStar = false): Row {
  return {
    league_id: LEAGUE,
    week,
    player_id: playerId,
    slot_type: 'starter',
    position_in_lineup: position,
    is_star: isStar,
  };
}

function seed(markerWeek: number | null, platform = 'manual') {
  const mem = new MemSupabase();
  const league = { id: LEAGUE, platform, manual_lineup_week: markerWeek };
  mem.rows('leagues').push({ ...league, user_id: 'user-1', season_year: 2026 });
  return { mem, league, db: mem as unknown as SupabaseServiceClient };
}

function weekSlots(mem: MemSupabase, week: number, leagueId = LEAGUE) {
  return mem
    .rows('lineup_slots')
    .filter((row) => row['league_id'] === leagueId && row['week'] === week)
    .map((row) => ({
      player_id: row['player_id'],
      position_in_lineup: row['position_in_lineup'],
      slot_type: row['slot_type'],
      is_star: row['is_star'],
    }));
}

describe('carryManualLineupForward', () => {
  it('copies the last saved week into the new week, stars included, and advances the week', async () => {
    const { mem, league, db } = seed(10);
    mem.rows('lineup_slots').push(slot(10, QB, 'QB', true), slot(10, RB, 'RB1'));

    await expect(carryManualLineupForward(db, league, 11)).resolves.toBe(true);

    expect(weekSlots(mem, 11)).toEqual([
      { player_id: QB, position_in_lineup: 'QB', slot_type: 'starter', is_star: true },
      { player_id: RB, position_in_lineup: 'RB1', slot_type: 'starter', is_star: false },
    ]);
    // Last week's rows stay where they were.
    expect(weekSlots(mem, 10)).toHaveLength(2);
    expect(mem.byId('leagues', LEAGUE)['manual_lineup_week']).toBe(11);
    expect(league.manual_lineup_week).toBe(11);
  });

  it('skips weeks with no lineup: a lineup saved in week 8 shows up in week 11', async () => {
    const { mem, league, db } = seed(8);
    mem.rows('lineup_slots').push(slot(8, WR, 'WR1'));

    await carryManualLineupForward(db, league, 11);

    expect(weekSlots(mem, 11).map((row) => row.player_id)).toEqual([WR]);
  });

  it('is a no-op once the week has been carried', async () => {
    const { mem, league, db } = seed(10);
    mem.rows('lineup_slots').push(slot(10, QB, 'QB'));
    await carryManualLineupForward(db, league, 11);

    await expect(carryManualLineupForward(db, league, 11)).resolves.toBe(false);
    expect(weekSlots(mem, 11)).toHaveLength(1);
  });

  it('keeps a saved empty lineup empty', async () => {
    const { mem, league, db } = seed(10);
    mem.rows('lineup_slots').push(slot(9, QB, 'QB'));

    await expect(carryManualLineupForward(db, league, 11)).resolves.toBe(false);

    expect(weekSlots(mem, 11)).toEqual([]);
    expect(mem.byId('leagues', LEAGUE)['manual_lineup_week']).toBe(11);
  });

  it('leaves a week that already has slots alone', async () => {
    const { mem, league, db } = seed(10);
    mem.rows('lineup_slots').push(slot(10, QB, 'QB'), slot(11, RB, 'RB1'));

    await expect(carryManualLineupForward(db, league, 11)).resolves.toBe(false);

    expect(weekSlots(mem, 11).map((row) => row.player_id)).toEqual([RB]);
    expect(mem.byId('leagues', LEAGUE)['manual_lineup_week']).toBe(11);
  });

  it('never carries backward into an earlier week', async () => {
    const { mem, league, db } = seed(11);
    mem.rows('lineup_slots').push(slot(11, QB, 'QB'));

    await expect(carryManualLineupForward(db, league, 10)).resolves.toBe(false);

    expect(weekSlots(mem, 10)).toEqual([]);
    expect(mem.byId('leagues', LEAGUE)['manual_lineup_week']).toBe(11);
  });

  it('does nothing for a manual league that never saved a lineup', async () => {
    const { mem, league, db } = seed(null);

    await expect(carryManualLineupForward(db, league, 11)).resolves.toBe(false);

    expect(mem.rows('lineup_slots')).toEqual([]);
    expect(mem.byId('leagues', LEAGUE)['manual_lineup_week']).toBeNull();
  });

  it('never touches a Sleeper league', async () => {
    const { mem, league, db } = seed(10, 'sleeper');
    mem.rows('lineup_slots').push(slot(10, QB, 'QB'));

    await expect(carryManualLineupForward(db, league, 11)).resolves.toBe(false);

    expect(weekSlots(mem, 11)).toEqual([]);
    expect(mem.byId('leagues', LEAGUE)['manual_lineup_week']).toBe(10);
  });

  it('copies only this league', async () => {
    const { mem, league, db } = seed(10);
    mem
      .rows('lineup_slots')
      .push(slot(10, QB, 'QB'), { ...slot(10, RB, 'RB1'), league_id: OTHER_LEAGUE });

    await carryManualLineupForward(db, league, 11);

    expect(weekSlots(mem, 11).map((row) => row.player_id)).toEqual([QB]);
    expect(weekSlots(mem, 11, OTHER_LEAGUE)).toEqual([]);
  });
});

describe('markManualLineupWeek', () => {
  it('moves the week forward and never back', async () => {
    const { mem, league, db } = seed(null);

    await markManualLineupWeek(db, league, 9);
    expect(mem.byId('leagues', LEAGUE)['manual_lineup_week']).toBe(9);

    await markManualLineupWeek(db, league, 7);
    expect(mem.byId('leagues', LEAGUE)['manual_lineup_week']).toBe(9);
  });

  it('ignores Sleeper leagues', async () => {
    const { mem, league, db } = seed(null, 'sleeper');
    await markManualLineupWeek(db, league, 9);
    expect(mem.byId('leagues', LEAGUE)['manual_lineup_week']).toBeNull();
  });
});
