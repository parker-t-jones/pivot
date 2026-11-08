import { describe, expect, it } from 'vitest';

import { orderPicks, pickPhase } from './pickOrder';

function pick(id: string, gameId: string, kickoff: string, status = 'scheduled') {
  return { id, game_id: gameId, game: { scheduled_start: kickoff, status } };
}

const EARLY = '2026-11-08T18:00:00.000Z';
const LATE = '2026-11-08T21:25:00.000Z';
const NIGHT = '2026-11-09T01:20:00.000Z';

describe('orderPicks', () => {
  it('puts live first, then upcoming by kickoff, then finals at the bottom', () => {
    const picks = [
      pick('final-early', 'g-a', EARLY),
      pick('night', 'g-c', NIGHT),
      pick('late', 'g-b', LATE),
      pick('live', 'g-d', LATE),
    ];
    const weekGames = [
      { game_id: 'g-a', status: 'final', scheduled_start: EARLY },
      { game_id: 'g-b', status: 'scheduled', scheduled_start: LATE },
      { game_id: 'g-c', status: 'scheduled', scheduled_start: NIGHT },
      { game_id: 'g-d', status: 'in_progress', scheduled_start: LATE },
    ];
    expect(orderPicks(picks, weekGames, []).map((p) => p.id)).toEqual([
      'live',
      'late',
      'night',
      'final-early',
    ]);
  });

  it('treats a live-feed game as live even before the schedule catches up', () => {
    const picks = [pick('a', 'g-a', EARLY), pick('b', 'g-b', LATE)];
    expect(orderPicks(picks, null, [{ game_id: 'g-b' }]).map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('never lifts a final back to live because of a stale live-feed entry', () => {
    const picks = [pick('final', 'g-a', EARLY, 'final'), pick('next', 'g-b', LATE)];
    expect(orderPicks(picks, null, [{ game_id: 'g-a' }]).map((p) => p.id)).toEqual([
      'next',
      'final',
    ]);
  });

  it('falls back to the stake game when the schedule did not load, and keeps input order on ties', () => {
    const picks = [
      pick('second-on-game', 'g-a', EARLY),
      pick('no-game', 'g-x', EARLY),
      pick('first-on-game', 'g-a', EARLY),
    ];
    (picks[1] as { game: unknown }).game = null;
    expect(orderPicks(picks, null, []).map((p) => p.id)).toEqual([
      'second-on-game',
      'first-on-game',
      'no-game',
    ]);
  });

  it('does not mutate its input', () => {
    const picks = [pick('b', 'g-b', LATE), pick('a', 'g-a', EARLY)];
    orderPicks(picks, null, []);
    expect(picks.map((p) => p.id)).toEqual(['b', 'a']);
  });
});

describe('pickPhase', () => {
  it('lets the week schedule override the stake game status', () => {
    const p = pick('a', 'g-a', EARLY, 'scheduled');
    expect(
      pickPhase(p, [{ game_id: 'g-a', status: 'final', scheduled_start: EARLY }], new Set()),
    ).toBe('final');
  });
});
