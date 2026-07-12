import { createLineupCacheProvider } from './cache/index.js';
import { env } from './env.js';
import { createSupabaseServiceClient } from './lib/supabase.js';
import { runWorkerCycle, type WorkerCycleState } from './lib/worker-cycle.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000;

const deps = {
  supabase: createSupabaseServiceClient(env),
  lineupCache: createLineupCacheProvider(env),
};

let state: WorkerCycleState = { lastDailySyncAt: null };
let cycleInFlight = false;

async function tick(): Promise<void> {
  // A sync cycle could in principle outlast the poll interval; skip rather than overlap.
  if (cycleInFlight) return;
  cycleInFlight = true;
  try {
    const result = await runWorkerCycle(deps, state);
    state = result.nextState;
    if (result.ran) {
      console.log(
        `[lineup-sync-worker] synced ${result.syncedLeagueCount} league(s), ` +
          `${result.failedLeagueCount} failed.`,
      );
    }
  } catch (error) {
    console.error('[lineup-sync-worker] cycle failed:', error);
  } finally {
    cycleInFlight = false;
  }
}

await tick();
setInterval(tick, POLL_INTERVAL_MS);
