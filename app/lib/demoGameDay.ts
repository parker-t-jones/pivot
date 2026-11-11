/**
 * Local-only demo game day (issue #32 / PIVOT-STAKES-PLAN.md §12.2). Recon found that
 * `services/api/src/lib/demoFixture.ts` (the App Store reviewer demo) can't be reused here: it's
 * server-only code (imports `node:crypto`, `@pivot/dispatcher`'s Supabase-backed types, and a
 * `SupabaseServiceClient`) and its slate uses real NFL teams, which this demo must not. This is a
 * separate, bundled fixture with fictional teams, driven by a plain elapsed-time state machine —
 * no server calls, no `stakes`/`lineup_slots` writes.
 *
 * The live phase renders Home's live day (issue #71): the real `LiveStakeGameCard` fed by a
 * `LiveGame` and a `LiveStakeCardModel` built here from fictional ids, with the shared `PickCard`s
 * under it. The pick-hit moment runs through the same `usePickHitFlash` + `PickEventFlash` the
 * Watchlist uses (issue #44), fed by these snapshots.
 *
 * Issue #69: a short demo (about 30s) that tells Pivot's story, three alerts about one pick, evenly
 * spaced, ending on the hit. Every moment is a constant below; the screen only reads the clock.
 */

import type { PickProgress } from '@pivot/shared/picks';

import { buildLiveStakeCards, type LiveStakeCardModel } from './liveStakeCards';
import type { LiveGame } from './schedule';
import { theme } from './theme';

/** The countdown shows 10 down to 1, then the game goes live. */
export const DEMO_COUNTDOWN_START = 10;
/** Real time per displayed countdown second. Sped up on purpose: 10 "seconds" last about 6s. */
export const DEMO_COUNTDOWN_TICK_MS = 600;
export const DEMO_PRE_GAME_MS = DEMO_COUNTDOWN_START * DEMO_COUNTDOWN_TICK_MS;

/** Gap between the three alerts. The issue's band is never under 6s and never over 12s. */
export const DEMO_ALERT_SPACING_MS = 8_000;
export const DEMO_ALERT_MIN_SPACING_MS = 6_000;
export const DEMO_ALERT_MAX_SPACING_MS = 12_000;
/** How long an in-app alert banner stays up. Shorter than the minimum spacing, so two never overlap. */
export const DEMO_ALERT_VISIBLE_MS = 5_000;

/** Alert 1 fires as the demo goes live; alert 3 is the hit. */
export const DEMO_ACTIVE_AT_MS = DEMO_PRE_GAME_MS;
export const DEMO_CLOSING_AT_MS = DEMO_ACTIVE_AT_MS + DEMO_ALERT_SPACING_MS;
/** When the demo player prop clears its line, together with the third alert and the celebration. */
export const DEMO_HIT_AT_MS = DEMO_CLOSING_AT_MS + DEMO_ALERT_SPACING_MS;
/** A short hold on the hit before "Demo complete". */
export const DEMO_HOLD_MS = 8_000;
export const DEMO_TOTAL_MS = DEMO_HIT_AT_MS + DEMO_HOLD_MS;
export const DEMO_LIVE_MS = DEMO_TOTAL_MS - DEMO_PRE_GAME_MS;

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

/**
 * The number the countdown card shows at a point in the timeline: 10 at the start, 1 for the last
 * 600ms, 0 once the game is live. Pure, so a test can walk it without a timer.
 */
export function demoCountdownAtElapsed(elapsedMs: number): number {
  const left = Math.ceil((DEMO_PRE_GAME_MS - elapsedMs) / DEMO_COUNTDOWN_TICK_MS);
  return Math.min(DEMO_COUNTDOWN_START, Math.max(0, left));
}

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

/** The real client `LiveGame` (`GET /games/live`), so Home's own components take it unchanged. */
export type DemoLiveGame = LiveGame;

export interface DemoSnapshot {
  picks: readonly DemoPick[];
  live: DemoLiveGame | null;
}

const DEMO_KICKOFF_ISO = '2026-11-15T18:00:00.000Z';

function demoGame(status: string): DemoPick['game'] {
  return {
    scheduled_start: DEMO_KICKOFF_ISO,
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
        subject: { type: 'PLAYER', playerId: DEMO_PLAYER_ID, teamId: DEMO_HOME_TEAM.abbr },
        condition: { type: 'STAT_OVER', stat: 'REC_YDS', line: PROP_LINE },
        label: `${DEMO_PLAYER_NAME} over ${PROP_LINE} rec yds`,
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

/** Where the ball is at one beat. `yardsToEndzone` counts from the team with the ball. */
interface DemoSituation {
  yardsToEndzone: number;
  down: number | null;
  distance: number | null;
}

/**
 * One beat of the one fictional game. CMT has the ball at all three beats (a drive that ends in the
 * touchdown catch, the extra point still to come), so the hero stays NOW ACTIVE with the player on
 * the field. The neutral team colors are the same ones the app shows for a team it has no colors
 * for; no real team mark is drawn.
 */
function liveAt(
  home: number,
  away: number,
  clockSec: number,
  situation: DemoSituation,
): DemoLiveGame {
  return {
    game_id: DEMO_GAME_ID,
    status: 'in_progress',
    scheduled_start: DEMO_KICKOFF_ISO,
    home_team: DEMO_HOME_TEAM.abbr,
    away_team: DEMO_AWAY_TEAM.abbr,
    home_team_name: DEMO_HOME_TEAM.name,
    away_team_name: DEMO_AWAY_TEAM.name,
    home_team_primary_color: theme.colors.surface,
    home_team_secondary_color: theme.colors.border,
    away_team_primary_color: theme.colors.surface,
    away_team_secondary_color: theme.colors.border,
    score: { home, away },
    quarter: 3,
    time_remaining_sec: clockSec,
    possession_team: DEMO_HOME_TEAM.abbr,
    yards_to_endzone: situation.yardsToEndzone,
    down: situation.down,
    distance: situation.distance,
    in_red_zone: situation.yardsToEndzone <= 20,
  };
}

/** The demo player's receiving yards at each beat. The alert copy below reads these same numbers. */
export const DEMO_REC_YDS = { active: 47, closing: 62, hit: 70 } as const;
export const DEMO_PLAYER_NAME = 'R. Vance';
export const DEMO_PLAYER_ID = 'demo-player';

/** Constant snapshots, so a tick that changes nothing keeps the same array for the hit diff. */
const DEMO_SNAPSHOTS = {
  pre: snapshot('scheduled', null, null),
  // CMT at its own 25, 1st and 10: the drive starts.
  active: snapshot(
    'in_progress',
    liveAt(10, 7, 460, { yardsToEndzone: 75, down: 1, distance: 10 }),
    DEMO_REC_YDS.active,
  ),
  // 2nd and 7 at the HBR 34: the gauge marker has moved up the field.
  closing: snapshot(
    'in_progress',
    liveAt(10, 7, 355, { yardsToEndzone: 34, down: 2, distance: 7 }),
    DEMO_REC_YDS.closing,
  ),
  // The touchdown catch: 17-7, the extra point at the HBR 2 (no down), so RED ZONE shows.
  hit: snapshot(
    'in_progress',
    liveAt(17, 7, 252, { yardsToEndzone: 2, down: null, distance: null }),
    DEMO_REC_YDS.hit,
  ),
} as const;

/**
 * The demo picks and game at a point in the timeline. Each step changes at the same instant as its
 * alert, so the card and the alert message always agree: 47 live, 62 closing in, 70 hit.
 */
export function demoSnapshotAtElapsed(elapsedMs: number): DemoSnapshot {
  if (elapsedMs < DEMO_ACTIVE_AT_MS) return DEMO_SNAPSHOTS.pre;
  if (elapsedMs < DEMO_CLOSING_AT_MS) return DEMO_SNAPSHOTS.active;
  if (elapsedMs < DEMO_HIT_AT_MS) return DEMO_SNAPSHOTS.closing;
  return DEMO_SNAPSHOTS.hit;
}

export type DemoAlertKind = 'active' | 'closing' | 'hit';

export interface DemoAlert {
  kind: DemoAlertKind;
  /** When it fires, in demo elapsed ms. */
  atMs: number;
  /** Clearly labeled as a demo so it can never be mistaken for a real alert (§12.2). */
  title: string;
  body: string;
}

/**
 * The three alerts about the one pick, in order. The first is a routing nudge and reveals nothing;
 * the second and third carry numbers that match the card at the same instant. Fictional player and
 * teams only; nothing about odds, the broadcast or money.
 */
export const DEMO_ALERTS: readonly DemoAlert[] = [
  {
    kind: 'active',
    atMs: DEMO_ACTIVE_AT_MS,
    title: 'Demo alert: your pick is live',
    body: `${DEMO_PLAYER_NAME} is on the field for your pick.`,
  },
  {
    kind: 'closing',
    atMs: DEMO_CLOSING_AT_MS,
    title: 'Demo alert: your pick is closing in',
    body: `${DEMO_PLAYER_NAME} is at ${DEMO_REC_YDS.closing} of ${PROP_LINE} receiving yards.`,
  },
  {
    kind: 'hit',
    atMs: DEMO_HIT_AT_MS,
    title: 'Demo alert: pick hit',
    body: `${DEMO_PLAYER_NAME} cleared ${PROP_LINE} with ${DEMO_REC_YDS.hit} yards.`,
  },
];

/** Demo notifications have their own banner on the demo screen. */
export function isDemoNotificationData(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false;
  return (
    'demo' in data &&
    data.demo === true &&
    'kind' in data &&
    DEMO_ALERTS.some((alert) => alert.kind === data.kind)
  );
}

/** A stretch of demo time the app spent in the background while the OS could deliver alerts. */
export interface DemoBackgroundSpan {
  fromMs: number;
  toMs: number;
}

/**
 * Which alerts the screen should act on at this point. `due` is every alert whose time has come and
 * that has not been handled yet. `show` is the part of `due` to present as an in-app banner: an
 * alert that fell inside a stretch where the app was backgrounded and the OS had the local
 * notification scheduled was already shown by the OS, so showing it again would double it.
 * Pure; the screen marks `due` handled.
 */
export function demoAlertsToPresent(input: {
  elapsedMs: number;
  handled: ReadonlySet<DemoAlertKind>;
  osSpans: readonly DemoBackgroundSpan[];
}): { due: DemoAlert[]; show: DemoAlert[] } {
  const due = DEMO_ALERTS.filter(
    (alert) => alert.atMs <= input.elapsedMs && !input.handled.has(alert.kind),
  );
  const show = due.filter(
    (alert) => !input.osSpans.some((span) => alert.atMs >= span.fromMs && alert.atMs <= span.toMs),
  );
  return { due, show };
}

/** The hero's button. The real label names the person's own streaming service; the demo has none. */
export const DEMO_WATCH_LABEL = 'Watch on your service';
/** What a tap on that button says instead of opening anything. */
export const DEMO_WATCH_HINT = 'Demo only: in the real app this opens your streaming service.';

/**
 * Home's live game card model for the demo, built by the real `buildLiveStakeCards` from the
 * fictional game, so the rank, the NOW ACTIVE label, the on-field chip and the field gauge inputs
 * follow the same rules as Home. The player is flagged while CMT has the ball (every beat). Nothing
 * is looked up: no broadcasts, so the label is the demo's own and nothing here can open a link.
 */
export function demoLiveStakeCards(live: DemoLiveGame | null): LiveStakeCardModel[] {
  if (!live) return [];
  const cards = buildLiveStakeCards({
    liveGames: [live],
    stakeGameIds: new Set([DEMO_GAME_ID]),
    activeFlags: [
      {
        game_id: DEMO_GAME_ID,
        priority_score: 1,
        flagged_players: [{ player_id: DEMO_PLAYER_ID }],
      },
    ],
    playersByGameId: new Map([
      [
        DEMO_GAME_ID,
        [
          {
            playerId: DEMO_PLAYER_ID,
            firstName: 'R.',
            lastName: 'Vance',
            position: 'WR',
            teamAbbreviation: DEMO_HOME_TEAM.abbr,
          },
        ],
      ],
    ]),
    betsByGameId: new Map(),
    watchByGameId: new Map(),
  });
  return cards.map((card) => ({ ...card, buttonLabel: DEMO_WATCH_LABEL, opensLink: true }));
}
