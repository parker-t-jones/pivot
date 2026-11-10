/**
 * Local-only demo game day (issue #32 / PIVOT-STAKES-PLAN.md §12.2). Recon found that
 * `services/api/src/lib/demoFixture.ts` (the App Store reviewer demo) can't be reused here: it's
 * server-only code (imports `node:crypto`, `@pivot/dispatcher`'s Supabase-backed types, and a
 * `SupabaseServiceClient`) and its slate uses real NFL teams, which this demo must not. This is a
 * separate, bundled fixture with fictional teams, driven by a plain elapsed-time state machine —
 * no server calls, no `stakes`/`lineup_slots` writes.
 *
 * The live phase renders the real `PickCard`, and the pick-hit moment runs through the same
 * `usePickHitFlash` + `PickEventFlash` the Watchlist uses (issue #44), fed by these snapshots.
 */

import type { PickProgress } from '@pivot/shared/picks';

import {
  downDistanceLabel,
  fieldPositionLabel,
  formatClock,
  opponentAbbreviation,
  quarterLabel,
} from './gameDisplay';

export const DEMO_PRE_GAME_MS = 15_000;
export const DEMO_LIVE_MS = 75_000;
export const DEMO_TOTAL_MS = DEMO_PRE_GAME_MS + DEMO_LIVE_MS;

export type DemoPhase = 'pre_game' | 'live' | 'done';

/** Pure phase lookup so the timeline is unit-testable without mounting the screen or a timer. */
export function demoPhaseAtElapsed(elapsedMs: number): DemoPhase {
  if (elapsedMs < DEMO_PRE_GAME_MS) return 'pre_game';
  if (elapsedMs < DEMO_TOTAL_MS) return 'live';
  return 'done';
}

/** Fictional teams — never a real NFL abbreviation or name, in the UI or the notification. */
export const DEMO_HOME_TEAM = { abbr: 'CMT', name: 'Comets' } as const;
export const DEMO_AWAY_TEAM = { abbr: 'HBR', name: 'Harbor' } as const;

export const DEMO_GAME_ID = 'demo-game';

/** When the demo player prop clears its line: 20s into the live phase. */
export const DEMO_HIT_AT_MS = DEMO_PRE_GAME_MS + 20_000;
const DEMO_SECOND_STEP_MS = DEMO_PRE_GAME_MS + 10_000;

/** A demo pick in the same shape the Watchlist renders and diffs (`GET /picks` via `ManualStake`). */
export interface DemoPick {
  id: string;
  game_id: string;
  subject: { type: string; teamId?: string; playerId?: string };
  condition: { type: string; line: number; stat?: string };
  label: string;
  progress: PickProgress;
  game: {
    scheduled_start: string;
    status: string;
    home_team_id: string;
    away_team_id: string;
    home_team: string;
    away_team: string;
  };
}

export interface DemoLiveGame {
  game_id: string;
  score: { home: number; away: number };
  quarter: number;
  time_remaining_sec: number;
  /** Possessing team abbreviation (always one of the two fictional teams). */
  possession_team: string;
  /** Yards from the possessing team to the opponent end zone. */
  yards_to_endzone: number;
  down: number;
  distance: number;
}

export interface DemoSnapshot {
  picks: readonly DemoPick[];
  live: DemoLiveGame | null;
}

function demoGame(status: string): DemoPick['game'] {
  return {
    scheduled_start: '2026-11-15T18:00:00.000Z',
    status,
    home_team_id: DEMO_HOME_TEAM.abbr,
    away_team_id: DEMO_AWAY_TEAM.abbr,
    home_team: DEMO_HOME_TEAM.abbr,
    away_team: DEMO_AWAY_TEAM.abbr,
  };
}

const PROP_LINE = 68.5;
const TEAM_LINE = 20.5;

function snapshot(
  status: 'scheduled' | 'in_progress',
  live: DemoLiveGame | null,
  recYds: number | null,
): DemoSnapshot {
  const homePoints = live?.score.home ?? null;
  const propProgress: PickProgress =
    recYds === null
      ? { status: 'pending' }
      : {
          status: recYds > PROP_LINE ? 'hit' : 'live',
          current: recYds,
          line: PROP_LINE,
          needed: Math.max(0, PROP_LINE - recYds),
        };
  const teamProgress: PickProgress =
    homePoints === null
      ? { status: 'pending' }
      : {
          status: 'live',
          current: homePoints,
          line: TEAM_LINE,
          needed: Math.max(0, TEAM_LINE - homePoints),
        };
  return {
    live,
    picks: [
      {
        id: 'demo-prop',
        game_id: DEMO_GAME_ID,
        subject: { type: 'PLAYER', playerId: 'demo-player', teamId: DEMO_HOME_TEAM.abbr },
        condition: { type: 'STAT_OVER', stat: 'REC_YDS', line: PROP_LINE },
        label: `R. Vance over ${PROP_LINE} rec yds`,
        progress: propProgress,
        game: demoGame(status),
      },
      {
        id: 'demo-team-total',
        game_id: DEMO_GAME_ID,
        subject: { type: 'TEAM', teamId: DEMO_HOME_TEAM.abbr },
        condition: { type: 'TEAM_TOTAL_OVER', line: TEAM_LINE },
        label: `${DEMO_HOME_TEAM.name} team total over ${TEAM_LINE}`,
        progress: teamProgress,
        game: demoGame(status),
      },
    ],
  };
}

function liveAt(
  home: number,
  away: number,
  clockSec: number,
  situation: Pick<DemoLiveGame, 'possession_team' | 'yards_to_endzone' | 'down' | 'distance'>,
): DemoLiveGame {
  return {
    game_id: DEMO_GAME_ID,
    score: { home, away },
    quarter: 3,
    time_remaining_sec: clockSec,
    ...situation,
  };
}

/**
 * Constant snapshots, so a tick that changes nothing keeps the same array for the hit diff. The
 * drive reads as a story: the Comets start at their own 25, reach the Harbor 34 (2nd & 7), and the
 * demo player's catch is the touchdown, so Harbor has the ball after it.
 */
const DEMO_SNAPSHOTS = {
  pre: snapshot('scheduled', null, null),
  kickoff: snapshot(
    'in_progress',
    liveAt(10, 7, 460, {
      possession_team: DEMO_HOME_TEAM.abbr,
      yards_to_endzone: 75,
      down: 1,
      distance: 10,
    }),
    47,
  ),
  drive: snapshot(
    'in_progress',
    liveAt(10, 7, 355, {
      possession_team: DEMO_HOME_TEAM.abbr,
      yards_to_endzone: 34,
      down: 2,
      distance: 7,
    }),
    58,
  ),
  hit: snapshot(
    'in_progress',
    liveAt(17, 7, 252, {
      possession_team: DEMO_AWAY_TEAM.abbr,
      yards_to_endzone: 75,
      down: 1,
      distance: 10,
    }),
    70,
  ),
} as const;

/** The demo picks and game at a point in the timeline. The prop goes LIVE → HIT at `DEMO_HIT_AT_MS`. */
export function demoSnapshotAtElapsed(elapsedMs: number): DemoSnapshot {
  if (elapsedMs < DEMO_PRE_GAME_MS) return DEMO_SNAPSHOTS.pre;
  if (elapsedMs < DEMO_SECOND_STEP_MS) return DEMO_SNAPSHOTS.kickoff;
  if (elapsedMs < DEMO_HIT_AT_MS) return DEMO_SNAPSHOTS.drive;
  return DEMO_SNAPSHOTS.hit;
}

/** The live row's header ticker, e.g. `LIVE · Q3 · 4:12`. */
export function demoTickerLine(live: DemoLiveGame): string {
  return `LIVE · ${quarterLabel(live.quarter)} · ${formatClock(live.time_remaining_sec)}`;
}

/** The live row's possession line, e.g. `CMT ball · 2nd & 7 · HBR 34`. */
export function demoPossessionLine(live: DemoLiveGame): string {
  const opponent = opponentAbbreviation(
    live.possession_team,
    DEMO_HOME_TEAM.abbr,
    DEMO_AWAY_TEAM.abbr,
  );
  return [
    `${live.possession_team} ball`,
    downDistanceLabel(live.down, live.distance),
    fieldPositionLabel(live.yards_to_endzone, live.possession_team, opponent),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

/** Clearly labeled as a demo so it can never be mistaken for a real alert (§12.2). */
export const DEMO_NOTIFICATION_TITLE = 'Demo alert — not a real game';
export const DEMO_NOTIFICATION_BODY = 'Your demo pick just went live. Tap to see the demo Home.';
