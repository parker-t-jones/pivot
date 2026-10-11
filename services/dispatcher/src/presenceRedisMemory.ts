import type { PresenceRedis } from './presence.js';

interface ScoredMember {
  member: string;
  score: number;
}

/**
 * In-process `PresenceRedis`. A key with a `PEXPIRE` disappears on the next read
 * or write once `now` passes that deadline, including when nobody sweeps it.
 */
export class MemoryPresenceRedis implements PresenceRedis {
  private readonly sets = new Map<string, ScoredMember[]>();
  private readonly hashes = new Map<string, Map<string, string>>();
  private readonly expiresAt = new Map<string, number>();
  readonly commands: string[] = [];

  zrangeByScore(key: string, min: number, max: number): Promise<string[]> {
    this.commands.push(`zrange ${key}`);
    this.dropIfExpired(key);
    const members = (this.sets.get(key) ?? []).filter((entry) => entry.score >= min && entry.score <= max);
    return Promise.resolve(members.map((entry) => entry.member));
  }

  zremRangeByScore(key: string, min: number, max: number): Promise<void> {
    this.commands.push(`zremrangebyscore ${key}`);
    this.dropIfExpired(key);
    const kept = (this.sets.get(key) ?? []).filter((entry) => entry.score < min || entry.score > max);
    if (kept.length === 0) this.sets.delete(key);
    else this.sets.set(key, kept);
    return Promise.resolve();
  }

  zadd(key: string, score: number, member: string): Promise<void> {
    this.commands.push(`zadd ${key} ${member}`);
    this.dropIfExpired(key);
    const rest = (this.sets.get(key) ?? []).filter((entry) => entry.member !== member);
    rest.push({ member, score });
    this.sets.set(key, rest);
    return Promise.resolve();
  }

  zrem(key: string, members: string[]): Promise<void> {
    this.commands.push(`zrem ${key}`);
    this.dropIfExpired(key);
    const drop = new Set(members);
    const kept = (this.sets.get(key) ?? []).filter((entry) => !drop.has(entry.member));
    if (kept.length === 0) this.sets.delete(key);
    else this.sets.set(key, kept);
    return Promise.resolve();
  }

  hgetAll(key: string): Promise<Record<string, string>> {
    this.commands.push(`hgetall ${key}`);
    this.dropIfExpired(key);
    return Promise.resolve(Object.fromEntries(this.hashes.get(key) ?? []));
  }

  hset(key: string, field: string, value: string): Promise<void> {
    this.commands.push(`hset ${key} ${field}`);
    this.dropIfExpired(key);
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    hash.set(field, value);
    this.hashes.set(key, hash);
    return Promise.resolve();
  }

  hdel(key: string, fields: string[]): Promise<void> {
    this.commands.push(`hdel ${key}`);
    this.dropIfExpired(key);
    const hash = this.hashes.get(key);
    if (!hash) return Promise.resolve();
    for (const field of fields) hash.delete(field);
    if (hash.size === 0) this.hashes.delete(key);
    return Promise.resolve();
  }

  pexpire(key: string, ttlMs: number): Promise<void> {
    this.commands.push(`pexpire ${key} ${ttlMs}`);
    this.expiresAt.set(key, Date.now() + ttlMs);
    return Promise.resolve();
  }

  del(keys: string[]): Promise<void> {
    for (const key of keys) {
      this.commands.push(`del ${key}`);
      this.sets.delete(key);
      this.hashes.delete(key);
      this.expiresAt.delete(key);
    }
    return Promise.resolve();
  }

  hasKey(key: string): boolean {
    this.dropIfExpired(key);
    return this.sets.has(key) || this.hashes.has(key);
  }

  members(key: string): string[] {
    this.dropIfExpired(key);
    return (this.sets.get(key) ?? []).map((entry) => entry.member);
  }

  hash(key: string): Record<string, string> {
    this.dropIfExpired(key);
    return Object.fromEntries(this.hashes.get(key) ?? []);
  }

  private dropIfExpired(key: string): void {
    const deadline = this.expiresAt.get(key);
    if (deadline === undefined || deadline >= Date.now()) return;
    this.sets.delete(key);
    this.hashes.delete(key);
    this.expiresAt.delete(key);
  }
}
