export interface SleeperLeagueUser {
  user_id: string;
  display_name: string | null;
  metadata?: { team_name?: string | null } | null;
}

/** `metadata.team_name` when it is non-empty, otherwise `display_name`. */
export function sleeperOpponentTeamName(user: SleeperLeagueUser | null | undefined): string | null {
  const teamName = user?.metadata?.team_name?.trim();
  if (teamName) return teamName;
  const displayName = user?.display_name?.trim();
  return displayName ? displayName : null;
}

export function opponentTeamNameForOwner(
  users: readonly SleeperLeagueUser[],
  ownerId: string | null,
): string | null {
  if (!ownerId) return null;
  return sleeperOpponentTeamName(users.find((user) => user.user_id === ownerId));
}
