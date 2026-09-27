import { describe, expect, it } from 'vitest';
import { guardRunnerStart, memoryCacheRefusal, startGuarded } from './redisGuard.js';

const PROD_HOST = 'willing-example.upstash.io';

describe('memory cache refusal', () => {
  it('refuses CACHE_DRIVER=memory so a process cannot hide lineups from the runner', () => {
    const reason = memoryCacheRefusal({ cacheDriver: 'memory', nodeEnv: undefined });
    expect(reason).toContain('CACHE_DRIVER=memory');
    expect(reason).toContain('runner reads them from Redis');
  });

  it('allows memory when NODE_ENV=test', () => {
    expect(memoryCacheRefusal({ cacheDriver: 'memory', nodeEnv: 'test' })).toBeNull();
  });

  it('allows redis outside tests', () => {
    expect(memoryCacheRefusal({ cacheDriver: 'redis', nodeEnv: undefined })).toBeNull();
  });
});

describe('production Redis host guard', () => {
  it('refuses a production-looking Redis URL before SET NX', async () => {
    let opened = false;
    let exitCode: number | undefined;
    const logs: string[] = [];
    await startGuarded(
      {
        cacheDriver: 'redis',
        nodeEnv: undefined,
        productionHost: PROD_HOST,
        redisUrls: [`rediss://default:secret@${PROD_HOST}:6379`],
        exit: (code) => {
          exitCode = code;
        },
        log: (line) => logs.push(line),
        openRedis: () => {
          opened = true;
          return { incr: () => Promise.resolve(1) };
        },
      },
      async () => {
        throw new Error('lead must not run');
      },
    );
    expect(opened).toBe(false);
    expect(exitCode).toBe(1);
    expect(logs[0]).toContain(PROD_HOST);
    expect(logs[0]).toContain('PRODUCTION_REDIS_HOST');
  });

  it('starts when the Redis host is local', () => {
    expect(
      guardRunnerStart({
        cacheDriver: 'redis',
        nodeEnv: undefined,
        productionHost: PROD_HOST,
        redisUrls: ['redis://127.0.0.1:6379'],
      }),
    ).toBeNull();
  });

  it('allows the production host when NODE_ENV is production', () => {
    expect(
      guardRunnerStart({
        cacheDriver: 'redis',
        nodeEnv: 'production',
        productionHost: PROD_HOST,
        redisUrls: [`rediss://${PROD_HOST}:6379`],
      }),
    ).toBeNull();
  });
});
