import type { GamePlayerStats } from '@pivot/shared';
import { normalizeName } from './playerMatch.js';

export type FirstTd =
  /** No touchdown in the scoring plays yet. */
  | { kind: 'none' }
  | { kind: 'scored'; teamId: string; espnId: string }
  /** A touchdown was scored, but its text names no athlete on the scoring team's boxscore. */
  | { kind: 'unknown'; teamId: string };

/**
 * ESPN plays carry no athlete ids, so the first TD scorer comes from the first touchdown in
 * `scoringPlays`: its text starts with the scorer's name ("Christian Watson 4 Yd pass from Jordan
 * Love"). The longest boxscore name on the scoring team that the text starts with wins, so
 * "Brian Robinson Jr." is never read as a shorter name that happens to prefix it.
 */
export function firstTouchdown(stats: GamePlayerStats): FirstTd {
  const play = stats.scoringPlays.find((candidate) => candidate.kind === 'TD');
  if (play === undefined) return { kind: 'none' };

  const text = normalizeName(play.text);
  let best: { espnId: string; length: number } | null = null;
  for (const [espnId, line] of Object.entries(stats.players)) {
    if (line.teamId !== play.teamId) continue;
    const name = normalizeName(line.displayName);
    if (name.length === 0) continue;
    if (text !== name && !text.startsWith(`${name} `)) continue;
    if (best === null || name.length > best.length) best = { espnId, length: name.length };
  }
  return best === null
    ? { kind: 'unknown', teamId: play.teamId }
    : { kind: 'scored', teamId: play.teamId, espnId: best.espnId };
}
