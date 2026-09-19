import type { FlaggedPlayer, GameSummary } from './flagEventPayload';

/**
 * Sprint 9 Phase 2 — closes two of the four Section 10 fidelity gaps (reason chip player names,
 * team color flash / possessing-team label) on top of Phase 1's server-side enrichment.
 *
 * Discovered gap (see report): neither `flagged_players` (Phase 1's own addition) nor the
 * possessing-team identity on `/flags/current` carries which *team* a flagged player belongs to —
 * `flagged_players` is deliberately the same `{ player_id, first_name, last_name, position }` shape
 * as the WebSocket payload, and Phase 1 intentionally kept `possession_team` off `/flags/current`
 * (PM ruling: "`game_summary` can carry that context if needed"). `game_summary` alone can't answer
 * "which of home/away is the flagged team," though — it holds both teams' names/colors symmetrically.
 *
 * The fix used here: `GET /leagues/:id/lineup` (already returns `player.team`) gives a client-side
 * `player_id -> team` map for free, cross-referenced against `game_summary.home_team`/`away_team`
 * abbreviations to figure out which side is "the flagged team." This works for the cold-start
 * `/flags/current` path. The realtime `flag_event` payload doesn't need this — Phase 1 put
 * `possession_team` directly on `new_state`, so `resolvePossessingTeamDisplay` below is the more
 * direct (and more authoritative, since it reflects live possession rather than roster affiliation)
 * resolution for that path.
 */

export interface TeamRef {
  teamId: string;
  abbreviation: string;
  name: string;
}

/** `player_id -> TeamRef`, built from one or more `GET /leagues/:id/lineup` responses. */
export type PlayerTeamMap = Map<string, TeamRef>;

export interface TeamDisplay {
  name: string;
  abbreviation: string;
  primaryColor: string;
  secondaryColor: string;
}

function sideForAbbreviation(game: GameSummary, abbreviation: string): 'home' | 'away' | null {
  if (abbreviation === game.home_team) return 'home';
  if (abbreviation === game.away_team) return 'away';
  return null;
}

function displayForSide(game: GameSummary, side: 'home' | 'away'): TeamDisplay {
  return side === 'home'
    ? {
        name: game.home_team_name,
        abbreviation: game.home_team,
        primaryColor: game.home_team_primary_color,
        secondaryColor: game.home_team_secondary_color,
      }
    : {
        name: game.away_team_name,
        abbreviation: game.away_team,
        primaryColor: game.away_team_primary_color,
        secondaryColor: game.away_team_secondary_color,
      };
}

/** Realtime path: `new_state.possession_team` is already a team abbreviation — just needs matching
 *  against `game_summary`'s home/away colors. `null` when there's no possession (special teams /
 *  between plays) or the abbreviation doesn't match either side (shouldn't happen, but a mismatch
 *  is a reason to fall back gracefully, not to throw). */
export function resolvePossessingTeamDisplay(
  game: GameSummary,
  possessionTeam: string | null,
): TeamDisplay | null {
  if (!possessionTeam) return null;
  const side = sideForAbbreviation(game, possessionTeam);
  return side ? displayForSide(game, side) : null;
}

/** Cold-start path: derives "the flagged team" from the first flagged player's own roster team
 *  (via `playerTeamMap`), matched against which side of `game_summary` that team plays on this
 *  game. Returns `null` if the player has no map entry (lineup not yet loaded) or their team
 *  matches neither side (shouldn't happen for a same-week matchup, but degrade gracefully). */
export function resolveFlaggedTeamDisplay(
  game: GameSummary,
  flaggedPlayers: FlaggedPlayer[],
  playerTeamMap: PlayerTeamMap,
): TeamDisplay | null {
  for (const player of flaggedPlayers) {
    const team = playerTeamMap.get(player.player_id);
    if (!team) continue;
    const side = sideForAbbreviation(game, team.abbreviation);
    if (side) return displayForSide(game, side);
  }
  return null;
}

function fullName(player: FlaggedPlayer): string {
  return `${player.first_name} ${player.last_name}`.trim();
}

export interface ReasonChipParts {
  /** Left of the pill divider — e.g. "Josh Allen +3 more active". */
  players: string;
  /** Right of the pill divider — team nickname only, or null when unresolved. */
  team: string | null;
}

/**
 * Section 10 reason chip, split for the Now Active pill layout:
 *   left  → "{name}[+N more] active" (and position when a single player)
 *   right → team nickname only ("Bills")
 *
 * Falls back gracefully when data is missing rather than guessing:
 *  - No flagged players at all -> `{ players: reasonType, team: null }` (callers usually check
 *    `flaggedPlayers.length` first and use `reasonLabel` instead).
 *  - Team unresolved -> `team: null` (pill renders without the divider/team segment).
 *  - More than one flagged player -> leads with the first and appends "+N more".
 */
export function reasonChipParts(
  reasonType: string,
  flaggedPlayers: FlaggedPlayer[],
  flaggedTeam: TeamDisplay | null,
): ReasonChipParts {
  const [lead, ...rest] = flaggedPlayers;
  if (!lead) return { players: reasonType, team: null };

  const nameSegment =
    rest.length > 0 ? `${fullName(lead)} +${rest.length} more` : fullName(lead);
  const positionSegment = rest.length > 0 ? null : lead.position;

  const players = [`${nameSegment} active`, positionSegment]
    .filter((segment): segment is string => Boolean(segment))
    .join(' — ');

  return {
    players,
    team: flaggedTeam?.name ?? null,
  };
}

/** Flat string form of `reasonChipParts` (tests / non-UI callers). Joins with an em dash. */
export function reasonChipCopy(
  reasonType: string,
  flaggedPlayers: FlaggedPlayer[],
  flaggedTeam: TeamDisplay | null,
): string {
  const { players, team } = reasonChipParts(reasonType, flaggedPlayers, flaggedTeam);
  return team ? `${players} — ${team}` : players;
}
