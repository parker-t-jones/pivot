/**
 * Local-only demo game day (issue #32 / PIVOT-STAKES-PLAN.md §12.2). Recon found that
 * `services/api/src/lib/demoFixture.ts` (the App Store reviewer demo) can't be reused here: it's
 * server-only code (imports `node:crypto`, `@pivot/dispatcher`'s Supabase-backed types, and a
 * `SupabaseServiceClient`) and its slate uses real NFL teams, which this demo must not. This is a
 * separate, bundled fixture with fictional teams, driven by a plain elapsed-time state machine —
 * no server calls, no `stakes`/`lineup_slots` writes.
 */

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

export interface DemoStake {
  id: string;
  title: string;
  subtitle: string;
}

/** Shown on the demo Watchlist pane. Never written to `stakes` — this array is the only copy. */
export const DEMO_STAKES: readonly DemoStake[] = [
  { id: 'demo-spread', title: 'Demo pick: spread', subtitle: `${DEMO_HOME_TEAM.name} -3.5` },
  { id: 'demo-total', title: 'Demo pick: total', subtitle: 'Over 44.5' },
];

/** Clearly labeled as a demo so it can never be mistaken for a real alert (§12.2). */
export const DEMO_NOTIFICATION_TITLE = 'Demo alert — not a real game';
export const DEMO_NOTIFICATION_BODY = 'Your demo pick just went live. Tap to see the demo Home.';
