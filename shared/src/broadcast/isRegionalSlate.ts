import { groupWindow } from './groupWindow.js';
import type { AiringNetwork, SlateGame } from './types.js';

const REGIONAL_NETWORKS = new Set<AiringNetwork>(['cbs', 'fox']);

/**
 * True when this game sits in a (groupWindow, cbs|fox) bucket with more than
 * one game — the Week 3 Sunday regional-split heuristic (§4.1).
 */
export function isRegionalSlate(game: SlateGame, weekGames: readonly SlateGame[]): boolean {
  const window = groupWindow(game.kickoff);
  for (const network of game.networks) {
    if (!REGIONAL_NETWORKS.has(network)) continue;
    let count = 0;
    for (const other of weekGames) {
      if (groupWindow(other.kickoff) !== window) continue;
      if (!other.networks.includes(network)) continue;
      count += 1;
    }
    if (count > 1) return true;
  }
  return false;
}
