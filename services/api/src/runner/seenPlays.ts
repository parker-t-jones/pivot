/** Keep restart deduplication for 48h after the last write, then retire old games (Parker #84). */
export const SEEN_PLAYS_TTL_SECONDS = 48 * 60 * 60;

export function espnSeenPlaysKey(espnEventId: string): string {
  return `espn_seen_plays:${espnEventId}`;
}

/** Redis set `espn_seen_plays:{espnEventId}`. Tests use the in-memory fake. */
export interface SeenPlaySet {
  add(espnEventId: string, playId: string): Promise<void>;
  has(espnEventId: string, playId: string): Promise<boolean>;
  members(espnEventId: string): Promise<ReadonlySet<string>>;
}

export class InMemorySeenPlaySet implements SeenPlaySet {
  private readonly sets = new Map<string, { members: Set<string>; expiresAt: number }>();

  async add(espnEventId: string, playId: string): Promise<void> {
    const key = espnSeenPlaysKey(espnEventId);
    const members = this.liveMembers(key) ?? new Set<string>();
    members.add(playId);
    this.sets.set(key, { members, expiresAt: Date.now() + SEEN_PLAYS_TTL_SECONDS * 1000 });
  }

  private liveMembers(key: string): Set<string> | undefined {
    const entry = this.sets.get(key);
    if (entry && entry.expiresAt <= Date.now()) {
      this.sets.delete(key);
      return undefined;
    }
    return entry?.members;
  }

  async has(espnEventId: string, playId: string): Promise<boolean> {
    return this.liveMembers(espnSeenPlaysKey(espnEventId))?.has(playId) ?? false;
  }

  async members(espnEventId: string): Promise<ReadonlySet<string>> {
    return new Set(this.liveMembers(espnSeenPlaysKey(espnEventId)) ?? []);
  }
}
