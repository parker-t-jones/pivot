/**
 * Turns one ESPN summary into poll-ordered prefixes for replay fixtures.
 * Not called by the live client. File layout matches `experiments/espn-live-recorder.ts`:
 * `<receivedAtISO>.json.gz`, plays counted as previous drives then `drives.current`.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

/** Same interval `EspnPlaySource` polls at, so prefix filenames sort in poll order. */
const PREFIX_POLL_INTERVAL_MS = 5000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Play count R1 uses: every `plays` array on `drives.previous`, then `drives.current`. */
export function countSummaryPlays(body: unknown): number {
  if (!isRecord(body)) return 0;
  const drives = body['drives'];
  if (!isRecord(drives)) return 0;
  let count = 0;
  const previous = drives['previous'];
  if (Array.isArray(previous)) {
    for (const drive of previous) {
      if (!isRecord(drive)) continue;
      const plays = drive['plays'];
      if (Array.isArray(plays)) count += plays.length;
    }
  }
  const current = drives['current'];
  if (isRecord(current)) {
    const plays = current['plays'];
    if (Array.isArray(plays)) count += plays.length;
  }
  return count;
}

function sliceDrive(
  drive: unknown,
  remaining: number,
): { drive: Record<string, unknown>; remaining: number } {
  if (!isRecord(drive)) {
    throw new Error('summary drive must be an object');
  }
  const clone = structuredClone(drive);
  const plays = clone['plays'];
  if (!Array.isArray(plays)) return { drive: clone, remaining };
  if (plays.length <= remaining) {
    return { drive: clone, remaining: remaining - plays.length };
  }
  clone['plays'] = plays.slice(0, remaining);
  return { drive: clone, remaining: 0 };
}

function prefixSummaryPlays(body: unknown, keep: number): unknown {
  const clone = structuredClone(body);
  if (!isRecord(clone)) throw new Error('summary body must be an object');
  const drives = clone['drives'];
  if (!isRecord(drives)) throw new Error('summary body has no drives object');

  let remaining = keep;
  const previous = drives['previous'];
  if (Array.isArray(previous)) {
    const kept: Record<string, unknown>[] = [];
    for (const drive of previous) {
      if (remaining === 0) break;
      const sliced = sliceDrive(drive, remaining);
      kept.push(sliced.drive);
      remaining = sliced.remaining;
    }
    drives['previous'] = kept;
  }

  if (remaining === 0) {
    delete drives['current'];
  } else if (isRecord(drives['current'])) {
    const sliced = sliceDrive(drives['current'], remaining);
    drives['current'] = sliced.drive;
    remaining = sliced.remaining;
  }

  if (remaining !== 0) {
    throw new Error(`could not build a ${keep}-play prefix`);
  }
  return clone;
}

/** First play, first two plays, … through `prefixCount`. Does not mutate `body`. */
export function summaryPlayPrefixes(body: unknown, prefixCount: number): unknown[] {
  if (!Number.isInteger(prefixCount) || prefixCount < 1) {
    throw new Error(`prefixCount must be a positive integer, got ${String(prefixCount)}`);
  }
  const total = countSummaryPlays(body);
  if (total < prefixCount) {
    throw new Error(`summary has ${total} plays, need at least ${prefixCount}`);
  }
  const prefixes: unknown[] = [];
  for (let count = 1; count <= prefixCount; count += 1) {
    prefixes.push(prefixSummaryPlays(body, count));
  }
  return prefixes;
}

/**
 * Writes `summaryPlayPrefixes` as gzipped JSON. Names are `baseReceivedAt` plus
 * 5s per step, `toISOString()`, so a directory sort is poll order.
 */
export async function writeSummaryPlayPrefixes(input: {
  body: unknown;
  directory: string;
  prefixCount: number;
  baseReceivedAt: Date;
}): Promise<string[]> {
  if (Number.isNaN(input.baseReceivedAt.getTime())) {
    throw new Error('baseReceivedAt is not a valid date');
  }
  const prefixes = summaryPlayPrefixes(input.body, input.prefixCount);
  await mkdir(input.directory, { recursive: true });
  const names: string[] = [];
  for (let index = 0; index < prefixes.length; index += 1) {
    const receivedAt = new Date(
      input.baseReceivedAt.getTime() + index * PREFIX_POLL_INTERVAL_MS,
    ).toISOString();
    const name = `${receivedAt}.json.gz`;
    const body = prefixes[index];
    await writeFile(path.join(input.directory, name), gzipSync(Buffer.from(JSON.stringify(body))));
    names.push(name);
  }
  return names;
}
