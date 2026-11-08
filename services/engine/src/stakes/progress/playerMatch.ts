import type { GamePlayerStats, ParsedPlayerLine } from '@pivot/shared';
import type { PropPlayer } from '../types.js';

/** Lowercase letters and digits only, single-spaced, with Jr./Sr./II–V suffixes dropped. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .split(/\s+/)
    .filter((part) => part.length > 0 && !['jr', 'sr', 'ii', 'iii', 'iv', 'v'].includes(part))
    .join(' ');
}

export type PlayerMatch =
  | { kind: 'found'; espnId: string; line: ParsedPlayerLine }
  /** The player has an ESPN id and is not in the boxscore (no stat yet, or did not play). */
  | { kind: 'absent'; espnId: string }
  /** No ESPN id and no name match on the player's team. */
  | { kind: 'unmatched' };

/**
 * `players.espn_id` first. Without one, the player's normalized full name against
 * `athlete.displayName` within the player's team (docs/P2-PICKS-MODEL.md §5).
 */
export function matchPlayer(player: PropPlayer, stats: GamePlayerStats): PlayerMatch {
  if (player.espnId !== null) {
    const line = stats.players[player.espnId];
    return line
      ? { kind: 'found', espnId: player.espnId, line }
      : { kind: 'absent', espnId: player.espnId };
  }
  const wanted = normalizeName(`${player.firstName} ${player.lastName}`);
  if (wanted.length === 0) return { kind: 'unmatched' };
  const hits = Object.entries(stats.players).filter(
    ([, line]) => line.teamId === player.teamId && normalizeName(line.displayName) === wanted,
  );
  const [only] = hits;
  if (hits.length !== 1 || only === undefined) return { kind: 'unmatched' };
  return { kind: 'found', espnId: only[0], line: only[1] };
}
