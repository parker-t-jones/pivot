import { describe, expect, it } from 'vitest';
import { RESUMPTION_CEILING_MS, type PlayEvent, type PlayType, type TeamId } from '@pivot/engine';
import {
  buildArrivals,
  classifyEnding,
  compareScoreboard,
  detectEarly,
  pairChanges,
  percentile,
  simulateToday,
  type Arrival,
  type PossessionWindow,
  type Snapshot,
  type SnapshotPlay,
} from './earlyNudge.js';

const GAME = 'g1';
const T0 = Date.parse('2026-09-28T00:00:00Z');

let nextId = 1;

function play(
  playType: PlayType,
  team: TeamId | null,
  endTeam: TeamId | null,
  extra: Partial<SnapshotPlay> = {},
): SnapshotPlay {
  const event: PlayEvent = {
    playId: `p${nextId++}`,
    gameId: GAME,
    week: 4,
    homeTeamId: 'PHI',
    awayTeamId: 'CHI',
    possessionTeamId: team,
    playType,
    scoreHome: 0,
    scoreAway: 0,
    quarter: 1,
    secondsRemainingInQuarter: 600,
    yardsToOpponentEndzone: team === null ? null : 50,
    down: team === null ? null : 1,
    distance: team === null ? null : 10,
    isFinalPlay: false,
  };
  return { event, endTeamId: endTeam, typeText: playType, text: '', driveResult: null, ...extra };
}

/** One snapshot per play, `stepS` seconds apart, after an initial empty snapshot. */
function arrive(plays: SnapshotPlay[], stepS = 40): ReturnType<typeof buildArrivals> {
  const snapshots: Snapshot[] = [{ receivedAtMs: T0, plays: [] }];
  plays.forEach((_, i) => {
    snapshots.push({ receivedAtMs: T0 + (i + 1) * stepS * 1000, plays: plays.slice(0, i + 1) });
  });
  return buildArrivals(snapshots);
}

async function replay(plays: SnapshotPlay[], stepS = 40) {
  const { arrivals, history } = arrive(plays, stepS);
  const today = await simulateToday(GAME, arrivals);
  const early = detectEarly(arrivals);
  return { arrivals, today, early, ...pairChanges(arrivals, history, today, early) };
}

const at = (seconds: number): number => T0 + seconds * 1000;

describe('buildArrivals', () => {
  it('keeps the first-seen version, flags backfill, and records end.team revisions and deletions', () => {
    const a = play('pass', 'PHI', 'PHI');
    const punt = play('punt', 'PHI', 'CHI');
    const revisedPunt = { ...punt, endTeamId: 'PHI' };
    const gone = play('run', 'CHI', 'CHI');
    const { arrivals, history } = buildArrivals([
      { receivedAtMs: at(0), plays: [a] },
      { receivedAtMs: at(5), plays: [a, punt, gone] },
      { receivedAtMs: at(10), plays: [a, revisedPunt] },
      { receivedAtMs: at(99), afterGap: true, plays: [a, revisedPunt, play('run', 'PHI', 'PHI')] },
    ]);

    expect(arrivals.map((x) => [x.seenAtMs, x.backfilled])).toEqual([
      [at(0), true],
      [at(5), false],
      [at(5), false],
      [at(99), true],
    ]);
    expect(arrivals[1].endTeamId).toBe('CHI');
    expect(history.get(punt.event.playId)?.endTeams).toEqual(['CHI', 'PHI']);
    expect(history.get(gone.event.playId)?.final).toBeNull();
  });
});

describe('detectEarly', () => {
  it('fires on the play whose end.team changes, skipping procedural entries', () => {
    const { arrivals } = arrive([
      play('pass', 'PHI', 'PHI'),
      play('punt', 'PHI', 'CHI'),
      play('timeout', null, 'PHI'),
      play('run', 'CHI', 'CHI'),
    ]);
    expect(detectEarly(arrivals)).toEqual([
      { team: 'CHI', from: 'PHI', index: 1, seenAtMs: at(80), source: 'end_team' },
    ]);
  });

  it('falls back to the drive team when end is missing', () => {
    const { arrivals } = arrive([play('punt', 'PHI', null), play('run', 'CHI', null)]);
    expect(detectEarly(arrivals)).toEqual([
      { team: 'CHI', from: 'PHI', index: 1, seenAtMs: at(80), source: 'drive_fallback' },
    ]);
  });
});

describe('simulateToday + pairChanges', () => {
  it('punt: today pushes on the first snap, early on the punt', async () => {
    const { changes, unmatchedEarly } = await replay([
      play('pass', 'PHI', 'PHI'),
      play('punt', 'PHI', 'CHI', { driveResult: 'Punt' }),
      play('run', 'CHI', 'CHI'),
    ]);
    expect(unmatchedEarly).toEqual([]);
    expect(changes).toHaveLength(1);
    const [change] = changes;
    expect(change.kind).toBe('punt');
    expect(change.today).toMatchObject({
      team: 'CHI',
      decision: 'fire_immediately',
      pushAtMs: at(120),
    });
    expect(change.early?.seenAtMs).toBe(at(80));
    expect(change.gainMs).toBe(40_000);
    expect(change.gainVsFirstSnapMs).toBe(40_000);
  });

  it('kickoff after a TD: the real gate holds the first-snap flag until the second snap', async () => {
    const { changes } = await replay([
      play('pass', 'PHI', 'PHI', { driveResult: 'Touchdown' }),
      play('kickoff', 'CHI', 'CHI'),
      play('run', 'CHI', 'CHI'),
      play('pass', 'CHI', 'CHI'),
    ]);
    const [change] = changes;
    expect(change.kind).toBe('kickoff_after_score');
    // PHI's flag_removed on the kickoff consumes the resolution, so CHI's flag parks mid-drive.
    expect(change.today).toMatchObject({ decision: 'held_pending_resumption', pushAtMs: at(160) });
    expect(change.early?.index).toBe(1);
    expect(change.gainMs).toBe(80_000);
    expect(change.gainVsFirstSnapMs).toBe(40_000);
  });

  it('kickoff after a FG: the carry-over fires on the first snap, unless a timeout sits between', async () => {
    const clean = await replay([
      play('field_goal', 'PHI', 'PHI', { driveResult: 'Field Goal' }),
      play('kickoff', 'CHI', 'CHI'),
      play('run', 'CHI', 'CHI'),
    ]);
    expect(clean.changes[0].today).toMatchObject({
      decision: 'fire_immediately',
      pushAtMs: at(120),
    });

    const withTimeout = await replay([
      play('field_goal', 'PHI', 'PHI', { driveResult: 'Field Goal' }),
      play('kickoff', 'CHI', 'CHI'),
      play('timeout', null, 'CHI'),
      play('run', 'CHI', 'CHI'),
      play('run', 'CHI', 'CHI'),
    ]);
    expect(withTimeout.changes[0].today).toMatchObject({
      decision: 'held_pending_resumption',
      pushAtMs: at(200),
    });
  });

  it('caps a mid-drive hold at the silence ceiling', async () => {
    const stepS = RESUMPTION_CEILING_MS / 1000 + 60;
    const { changes } = await replay(
      [
        play('pass', 'PHI', 'PHI', { driveResult: 'Touchdown' }),
        play('kickoff', 'CHI', 'CHI'),
        play('run', 'CHI', 'CHI'),
        play('pass', 'CHI', 'CHI'),
      ],
      stepS,
    );
    expect(changes[0].today?.pushAtMs).toBe(at(3 * stepS) + RESUMPTION_CEILING_MS);
  });

  it('end of half: an early nudge for a team that never snaps stays unmatched', async () => {
    const { changes, unmatchedEarly } = await replay([
      play('pass', 'PHI', 'PHI'),
      play('punt', 'PHI', 'CHI', { driveResult: 'Punt' }),
      play('end_half', null, 'CHI'),
      play('kickoff', 'PHI', 'PHI'),
      play('run', 'PHI', 'PHI'),
    ]);
    expect(changes).toEqual([]);
    expect(unmatchedEarly.map((n) => `${n.from}→${n.team}`)).toEqual(['PHI→CHI', 'CHI→PHI']);
  });
});

describe('classifyEnding', () => {
  const window = (over: Partial<PossessionWindow> = {}): PossessionWindow => ({
    from: 'PHI',
    to: 'CHI',
    precedingIndex: 0,
    revealingIndex: 1,
    openedIndex: 1,
    outcome: 'REAL_ACTION',
    resolvedAtMs: null,
    ...over,
  });
  const kindFor = (driveResult: string): string => {
    const { arrivals, history } = arrive([
      play('pass', 'PHI', 'CHI', { driveResult }),
      play('run', 'CHI', 'CHI'),
    ]);
    return classifyEnding(window(), arrivals, history);
  };

  it('maps drive results', () => {
    expect(kindFor('Punt')).toBe('punt');
    expect(kindFor('Touchdown')).toBe('kickoff_after_score');
    expect(kindFor('Field Goal')).toBe('kickoff_after_score');
    expect(kindFor('Interception')).toBe('turnover');
    expect(kindFor('Fumble')).toBe('turnover');
    expect(kindFor('Downs')).toBe('turnover_on_downs');
    expect(kindFor('Missed FG')).toBe('missed_fg');
    expect(kindFor('Punt Touchdown')).toBe('return_td');
    expect(kindFor('Safety')).toBe('safety');
    expect(kindFor('Something new')).toBe('other');
  });

  it('calls an aborted window, or one spanning end_half, end of half', () => {
    const { arrivals, history } = arrive([
      play('pass', 'PHI', 'PHI', { driveResult: 'Punt' }),
      play('end_half', null, null),
      play('kickoff', 'CHI', 'CHI'),
    ]);
    expect(classifyEnding(window({ openedIndex: 2 }), arrivals, history)).toBe('end_of_half');
    expect(classifyEnding(window({ outcome: 'ABORTED' }), arrivals, history)).toBe('end_of_half');
  });
});

describe('percentile', () => {
  it('interpolates and handles empty input', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([3, 1, 2], 0.5)).toBe(2);
    expect(percentile([0, 10], 0.9)).toBe(9);
  });
});

describe('compareScoreboard', () => {
  it('signs the lead and reports the summary ball at poll time', () => {
    const { arrivals } = arrive([play('pass', 'PHI', 'PHI'), play('punt', 'PHI', 'CHI')]);
    const byGame = new Map<string, readonly Arrival[]>([[GAME, arrivals]]);
    const [ahead, behind, unknown] = compareScoreboard(
      [
        { atMs: at(60), gameId: GAME, lastPlayId: arrivals[1].event.playId, possession: 'CHI' },
        { atMs: at(100), gameId: GAME, lastPlayId: arrivals[1].event.playId, possession: 'CHI' },
        { atMs: at(100), gameId: GAME, lastPlayId: 'missing', possession: null },
      ],
      byGame,
    );
    expect(ahead.leadMs).toBe(20_000);
    expect(ahead.staleMs).toBeNull();
    expect(ahead.summaryBall).toBe('PHI');
    expect(behind.leadMs).toBe(-20_000);
    expect(behind.staleMs).toBeNull();
    expect(behind.summaryBall).toBe('CHI');
    expect(unknown.leadMs).toBeNull();
  });

  it('measures staleness from the first later play the summary had', () => {
    const { arrivals } = arrive([play('pass', 'PHI', 'PHI'), play('punt', 'PHI', 'CHI')]);
    const [stale] = compareScoreboard(
      [{ atMs: at(110), gameId: GAME, lastPlayId: arrivals[0].event.playId, possession: 'PHI' }],
      new Map([[GAME, arrivals]]),
    );
    expect(stale.staleMs).toBe(30_000);
    expect(stale.summaryBall).toBe('CHI');
  });
});
