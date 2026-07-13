import type { RealtimeConnection } from './connection.js';

/**
 * Tracks every open `/v1/realtime` connection on this process, indexed both by connection id (for
 * removal) and by `userId` (a user may have multiple connections — e.g. phone + a second device —
 * and a `realtime:user:{id}` fan-out message must reach all of them). Per-connection `subscribedGameIds`
 * live on `RealtimeConnection` itself; `forGame` just filters the full connection list by it, since a
 * single process-wide `realtime:game:*` pattern subscription (not one per connection) is the whole
 * point of the Redis fan-out design.
 */
export class ConnectionRegistry {
  private readonly byId = new Map<string, RealtimeConnection>();
  private readonly byUser = new Map<string, Set<string>>();

  add(connection: RealtimeConnection): void {
    this.byId.set(connection.id, connection);
    const ids = this.byUser.get(connection.userId) ?? new Set<string>();
    ids.add(connection.id);
    this.byUser.set(connection.userId, ids);
  }

  remove(connectionId: string): void {
    const connection = this.byId.get(connectionId);
    if (!connection) return;
    this.byId.delete(connectionId);
    const ids = this.byUser.get(connection.userId);
    if (!ids) return;
    ids.delete(connectionId);
    if (ids.size === 0) this.byUser.delete(connection.userId);
  }

  forUser(userId: string): RealtimeConnection[] {
    const ids = this.byUser.get(userId);
    if (!ids) return [];
    return [...ids].flatMap((id) => {
      const connection = this.byId.get(id);
      return connection ? [connection] : [];
    });
  }

  forGame(gameId: string): RealtimeConnection[] {
    return [...this.byId.values()].filter((connection) => connection.subscribedGameIds.has(gameId));
  }

  all(): RealtimeConnection[] {
    return [...this.byId.values()];
  }

  hasConnection(userId: string): boolean {
    return (this.byUser.get(userId)?.size ?? 0) > 0;
  }

  size(): number {
    return this.byId.size;
  }
}
