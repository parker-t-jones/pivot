import type { PickProgress, PickStatus } from '@pivot/shared/picks';

import { isLegacyPick, progressReadout } from './pickProgressLine';

/**
 * The in-app "your pick just hit" moment (issue #44). It is driven only by `GET /picks` progress
 * the Watchlist already shows in-app (docs/P2-PICKS-MODEL.md §6), and never by a push.
 *
 * v1 covers singles with a progress line: player props and team/game props, including quarter
 * and half lines. Parlays, the four full-game legacy types, survivor, and fantasy rows are out.
 */

export interface FlashPick {
  id?: string;
  subject: { type: string };
  condition: { type: string; stat?: string; segment?: string };
  label?: string;
  progress?: PickProgress;
  legs?: readonly unknown[];
}

export type PickHitStatus = 'hit' | 'won';

export interface PickHit {
  id: string;
  status: PickHitStatus;
  label: string;
  /** "70 rec yds", or null for a pick with no number (first to score, anytime TD). */
  readout: string | null;
}

export interface PickHitTracker {
  /** Last status shown for each pick. Kept when a refetch fails and returns no rows. */
  readonly seen: ReadonlyMap<string, PickStatus>;
  /** Picks that already flashed. A stat correction that dips and re-hits never flashes twice. */
  readonly fired: ReadonlySet<string>;
}

export const EMPTY_PICK_HIT_TRACKER: PickHitTracker = { seen: new Map(), fired: new Set() };

/** Only a pick seen undecided can flash. A pick first seen already hit is not news to show. */
const UNDECIDED: ReadonlySet<PickStatus> = new Set<PickStatus>(['pending', 'live']);

function hitStatus(status: PickStatus | undefined): PickHitStatus | null {
  return status === 'hit' || status === 'won' ? status : null;
}

export function isFlashEligible(pick: FlashPick): boolean {
  if (pick.id == null || pick.progress == null) return false;
  if (pick.legs != null && pick.legs.length > 0) return false;
  if (pick.subject.type === 'SLIP') return false;
  return !isLegacyPick(pick);
}

/**
 * Compares one refetch against what was shown last. Returns the picks that went from pending or
 * live to hit or won, and the tracker to keep. The first call for a pick only records it.
 */
export function detectPickHits(
  tracker: PickHitTracker,
  picks: readonly FlashPick[],
): { tracker: PickHitTracker; hits: PickHit[] } {
  const seen = new Map(tracker.seen);
  const fired = new Set(tracker.fired);
  const hits: PickHit[] = [];
  for (const pick of picks) {
    if (!isFlashEligible(pick) || pick.id == null || pick.progress == null) continue;
    const status = pick.progress.status;
    const before = seen.get(pick.id);
    const hit = hitStatus(status);
    if (hit && before !== undefined && UNDECIDED.has(before) && !fired.has(pick.id)) {
      fired.add(pick.id);
      hits.push({
        id: pick.id,
        status: hit,
        label: pick.label ?? '',
        readout: progressReadout(pick),
      });
    }
    seen.set(pick.id, status);
  }
  return { tracker: { seen, fired }, hits };
}

export interface PickHitCopy {
  /** Lower-third headline: "PICK HIT · 70 REC YDS", "2 PICKS HIT". */
  headline: string;
  /** The pick itself: "D. Metcalf over 68.5 rec yds", or "… and 1 more pick". */
  detail: string;
  /** Screen-reader announcement, a full sentence. */
  announcement: string;
}

/**
 * Several hits in one refetch (the app reopened after a few plays) become one summarized moment,
 * not a queue: one flash per refetch keeps the payoff to a single beat.
 */
export function pickHitCopy(hits: readonly PickHit[]): PickHitCopy | null {
  const first = hits[0];
  if (!first) return null;
  const verb = hits.every((hit) => hit.status === 'won') ? 'WON' : 'HIT';
  const word = verb === 'WON' ? 'won' : 'hit';
  if (hits.length === 1) {
    const headline = first.readout
      ? `PICK ${verb} · ${first.readout.toUpperCase()}`
      : `PICK ${verb}`;
    return {
      headline,
      detail: first.label,
      announcement: `Your pick ${first.label} ${word}.`,
    };
  }
  const more = hits.length - 1;
  const morePicks = more === 1 ? '1 more pick' : `${more} more picks`;
  return {
    headline: `${hits.length} PICKS ${verb}`,
    detail: `${first.label} and ${morePicks}`,
    announcement: `${hits.length} of your picks ${word}: ${first.label} and ${morePicks}.`,
  };
}
