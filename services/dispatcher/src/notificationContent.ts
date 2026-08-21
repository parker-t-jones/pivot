import type { FlagEvent, FlagReason, FlagReasonType } from '@roster-remote/shared';
import type { PlayerInfo } from './catalogs.js';

/**
 * Sprint 6 Phase 2 — everything `notificationTitle`/`notificationBody` need about the game's current
 * on-field state, pre-resolved by the caller (`delivery.ts`, Phase 3/4) from `GameState` + team names
 * so these stay pure/I-O-free per the sprint instruction ("pure functions and easy to test
 * exhaustively") — plain strings/numbers, no ids requiring a lookup.
 *
 * `possessionTeamName`/`defenseTeamName` describe the CURRENT snapshot as of delivery time. For a
 * `flag_removed` event this is necessarily a best-effort "as of now" read, not "as of when the flag
 * was added" — `FlagState` (Section 8) carries player ids only, no historical team-identity data. In
 * the rare edge case where a defense flag clears BECAUSE the user's defended team just took the ball
 * away (a full turnover, not just a punt/stoppage), `defenseTeamName` in the current snapshot no
 * longer names that team. Accepted for v1 as a documented gap, same class as the engine's other
 * "good enough, called out" `FlagState`-staleness caveats.
 */
export interface NotificationGameContext {
  possessionTeamName: string | null;
  defenseTeamName: string | null;
  quarter: number;
  timeRemainingSec: number;
}

function quarterLabel(quarter: number): string {
  return quarter >= 5 ? 'OT' : `Q${quarter}`;
}

/** "Q2, 7:14" clock format (Section 10's example). Negative input (shouldn't occur) clamps to 0. */
function formatClock(timeRemainingSec: number): string {
  const clamped = Math.max(0, timeRemainingSec);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function findReason(reasons: FlagReason[], type: FlagReasonType): FlagReason | undefined {
  return reasons.find((r) => r.type === type);
}

function namesFor(playerIds: string[], players: PlayerInfo[]): string[] {
  const byId = new Map(players.map((p) => [p.playerId, p]));
  return playerIds.flatMap((id) => {
    const player = byId.get(id);
    return player ? [`${player.firstName} ${player.lastName}`] : [];
  });
}

type Tense = 'present' | 'past';

/**
 * The "who/what is active" half of the copy (Section 10's title style — short, no score/clock).
 * Shared logic for `notificationTitle`'s normal and `flag_removed` (past-tense) cases.
 *
 * Sprint decision (per sprint instruction): when `offense_active` and `defense_active` both fire —
 * Section 8's "user has players on both teams" edge case — offense wins the copy. The point is
 * describing what's happening on the field for this flag, not enumerating every stake the user has;
 * an active offensive player is the more concrete, player-level story to lead with.
 */
function describeSubject(
  reasons: FlagReason[],
  players: PlayerInfo[],
  game: Pick<NotificationGameContext, 'defenseTeamName'>,
  tense: Tense,
): string {
  const activeWord = tense === 'present' ? 'active' : 'no longer active';
  const onFieldPhrase = tense === 'present' ? 'on the field' : 'no longer on the field';

  const offense = findReason(reasons, 'offense_active');
  if (offense) {
    const names = namesFor(offense.triggeringPlayerIds, players);
    if (names.length === 1) return `${names[0]} ${activeWord}`;
    if (names.length > 1) return `${names.length} of your players ${activeWord}`;
    // length === 0 (ids present but none resolved by the caller) falls through to the defense check
    // below, then the fallback — same as if there were no offense_active reason at all.
  }

  const defense = findReason(reasons, 'defense_active');
  if (defense) {
    const teamName = game.defenseTeamName ?? 'Your defense';
    return `${teamName} defense ${onFieldPhrase}`;
  }

  // computeFlagState never produces a flagged FlagState without at least one of
  // offense_active/defense_active (Section 8) — this only guards a malformed/unexpected input.
  return tense === 'present' ? 'Your players active' : 'Your players no longer active';
}

/**
 * Section 10 title examples: `"Jonathan Taylor active"` (single player), `"3 of your players
 * active"` (multiple), `"Broncos defense on the field"` (defense flag, no offense). For
 * `flag_removed`, describes the reasons that were just cleared (`event.oldState`, since
 * `newState.reasons` is always empty on removal) in past tense — `"Jonathan Taylor no longer
 * active"` / `"Broncos defense no longer on the field"`. Not explicitly spelled out in Section 10
 * (only the *body* difference for `flag_removed` is called out there) — this extends the same
 * present/past pairing to the title for a consistent, testable removal case.
 */
export function notificationTitle(
  event: FlagEvent,
  game: NotificationGameContext,
  players: PlayerInfo[],
): string {
  if (event.type === 'flag_removed') {
    return describeSubject(event.oldState?.reasons ?? [], players, game, 'past');
  }
  return describeSubject(event.newState.reasons, players, game, 'present');
}

/**
 * Section 10 body example: `"Colts have the ball — Q2, 7:14. Tap to watch."` — always describes the
 * actual on-field situation (the possessing team), independent of which reason (offense or defense)
 * triggered the flag — per sprint instruction: describe what's happening on the field, not the
 * user's fantasy stake. A user flagged via `defense_active` (their defense is on the field against
 * the opponent's offense) still gets a body naming the opponent as "have the ball", same as anyone
 * else watching this game would read it.
 *
 * `notificationBody` takes no `players` param (unlike `notificationTitle`), so the two edge-case
 * bodies below deliberately don't repeat the player name the title already carries:
 *  - `priority_increased`-style copy (`red_zone` reason present): swaps the "have the ball" clause
 *    for "in the red zone", keeping the clock/CTA. Section 10's example string ("Colts in the red
 *    zone — Jonathan Taylor active") reads as the *title+body pair together* (the player name comes
 *    from `notificationTitle`, not this function) — the `(event, game)` signature has no player data
 *    to embed here.
 *  - `flag_removed`: "reflects that the possession changed" via the current possessing team, no
 *    player reference.
 * Applies the red-zone variant whenever `red_zone` is present in the reasons being described,
 * regardless of `event.type` — `computeFlagState` can attach `red_zone` on a `flag_added` just as
 * easily as a `priority_increased` (any state change while already in the red zone), and the more
 * urgent copy is worth showing either way; Section 10's "priority increased (e.g. red zone)" reads as
 * one illustrative trigger for this body, not a strict `event.type` gate.
 */
export function notificationBody(event: FlagEvent, game: NotificationGameContext): string {
  if (event.type === 'flag_removed') {
    const team = game.possessionTeamName;
    return team ? `Possession changed — ${team} has the ball now.` : 'Possession has changed.';
  }

  const team = game.possessionTeamName ?? 'The offense';
  const clock = `${quarterLabel(game.quarter)}, ${formatClock(game.timeRemainingSec)}`;

  if (findReason(event.newState.reasons, 'red_zone')) {
    return `${team} in the red zone — ${clock}. Tap to watch.`;
  }
  return `${team} have the ball — ${clock}. Tap to watch.`;
}
