/**
 * THROWAWAY TEST HARNESS CODE — not part of the Pivot app, not production code.
 *
 * Stamps the moment a play became visible on the broadcast, so the fire/visible gap can be computed
 * after the game instead of by stopwatch during it.
 *
 * This is the REDUNDANT ground-truth channel. The primary one is the screen recording with the
 * millisecond clock in frame, which is frame-accurate and immune to reaction time. Keypresses are
 * still worth capturing: they are cheap, they mark which moments were interesting enough to react to,
 * and they give a sanity check on the recording's timeline. Reaction lag (a few hundred ms) is a known
 * and acceptable error here — it is an order of magnitude below the ~30s quantity being measured.
 *
 * Timestamps come from `Date.now()` on the same machine as the harness and the on-screen clock, so
 * all three share one time source and no drift correction is needed.
 *
 * Usage:
 *   npx tsx experiments/mark-visible.ts
 *
 *   Then, during the game: hit Enter the instant a play becomes visible. Type an optional note first
 *   (a game id, "punt", "2min", "KC TD") and then Enter to label the marker.
 *   Ctrl-C to finish.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(__dirname, 'logs');

function stamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

async function main(): Promise<void> {
  await mkdir(LOG_DIR, { recursive: true });
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(LOG_DIR, `markers-${runId}.jsonl`);

  console.log('Marking broadcast-visible moments. Enter = stamp now, optional note first.');
  console.log(`Writing to ${logPath}\n`);

  let index = 0;
  const rl = createInterface({ input: process.stdin });

  // Read the timestamp before any await, so disk latency never lands in the measurement.
  for await (const line of rl) {
    const at = Date.now();
    index += 1;
    const note = line.trim();
    const record = { wall: at, index, note: note.length > 0 ? note : null };
    console.log(`  #${index} ${stamp(at)}${note ? ` — ${note}` : ''}`);
    try {
      await appendFile(logPath, `${JSON.stringify(record)}\n`, 'utf8');
    } catch (error) {
      console.error(`  [warn] failed to write marker: ${String(error)}`);
    }
  }

  console.log(`\n${index} marker(s) written to ${logPath}`);
}

main().catch((error: unknown) => {
  console.error('fatal:', error);
  process.exitCode = 1;
});
