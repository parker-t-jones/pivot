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
  private readonly sets = new Map<string, Set<string>>();

  async add(espnEventId: string, playId: string): Promise<void> {
    const key = espnSeenPlaysKey(espnEventId);
    const existing = this.sets.get(key);
    if (existing !== undefined) {
      existing.add(playId);
      return;
    }
    this.sets.set(key, new Set([playId]));
  }

  async has(espnEventId: string, playId: string): Promise<boolean> {
    return this.sets.get(espnSeenPlaysKey(espnEventId))?.has(playId) ?? false;
  }

  async members(espnEventId: string): Promise<ReadonlySet<string>> {
    return new Set(this.sets.get(espnSeenPlaysKey(espnEventId)) ?? []);
  }
}
