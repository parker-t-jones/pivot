/** Small adapter shared by TCP and REST clients; SCAN avoids blocking Redis with KEYS. */
export interface UserIndexRedis {
  scan(cursor: string, pattern: string): Promise<[string, string[]]>;
  srem(key: string, userId: string): Promise<unknown>;
  sadd(key: string, userId: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  zrem(key: string, userId: string): Promise<unknown>;
}

async function visitKeys(
  redis: UserIndexRedis,
  pattern: string,
  visit: (key: string) => Promise<unknown>,
): Promise<void> {
  let cursor = '0';
  do {
    const page = await redis.scan(cursor, pattern);
    cursor = page[0];
    for (const key of page[1]) await visit(key);
  } while (cursor !== '0');
}

/** No snapshot or expiring reverse index: repair even memberships written by older versions. */
export async function replaceUserStakes(
  redis: UserIndexRedis,
  userId: string,
  teamIds: readonly string[],
): Promise<void> {
  const wanted = new Set(teamIds.map((id) => `users_with_stake:${id}`));
  // Add first so a partial failure never removes a still-wanted route.
  for (const key of wanted) await redis.sadd(key, userId);
  await visitKeys(redis, 'users_with_stake:*', async (key) => {
    if (!wanted.has(key)) await redis.srem(key, userId);
  });
}

/** User IDs are UUIDs in production. Escape glob metacharacters for fake/local IDs too. */
function escapeGlob(value: string): string {
  return value.replace(/[\\*?\[\]]/g, '\\$&');
}

export async function removeUserIndexes(redis: UserIndexRedis, userId: string): Promise<void> {
  // Scan the forward indexes: snapshots and bet-game reverse indexes may already have expired.
  // Attempt every family even if one operation fails; callers log the aggregate failure.
  const id = escapeGlob(userId);
  const results = await Promise.allSettled([
    ...['users_with_stake:*', 'users_with_bet:*'].map((pattern) =>
      visitKeys(redis, pattern, (key) => redis.srem(key, userId)),
    ),
    ...[
      `user_lineup_cache:${id}:*`,
      `user_bet_games:${id}:*`,
      `user_flag_state:${id}:*`,
      `slip_import:${id}:*`,
      `user_notifications:${id}`,
      `presence:${id}`,
      `presence-vis:${id}`,
    ].map((pattern) => visitKeys(redis, pattern, (key) => redis.del(key))),
    redis.zrem('active_users', userId),
  ]);
  const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
  if (errors.length) throw new AggregateError(errors, 'Account cache cleanup incomplete');
}
