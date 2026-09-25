/**
 * THROWAWAY — not part of the Pivot app, not production code.
 *
 * Replays one game directory written by `espn-live-recorder.ts` through the production
 * parse and map path, fully offline.
 *
 * `espnClient.getSummary` always calls global `fetch` (`espnClient.ts`) and then validates
 * with `espnSummarySchema`. This script points that `fetch` at the recorded bytes. It does
 * not add an injectable client, and it does not open a socket.
 *
 *   npx tsx experiments/replay-recording.ts experiments/logs/recordings/<date>/<eventId>
 */

import { gunzipSync } from 'node:zlib';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PlayType } from '@pivot/engine';
import {
  espnClient,
  mapEspnPlay,
  resolveGameContext,
  type EspnDrive,
  type EspnGameContext,
  type EspnPlay,
  type EspnSummary,
} from '@pivot/ingestion';

const PLAY_TYPES: readonly PlayType[] = [
  'pass',
  'run',
  'qb_kneel',
  'qb_spike',
  'two_point_attempt',
  'punt',
  'field_goal',
  'kickoff',
  'extra_point',
  'no_play',
  'timeout',
  'end_period',
  'end_half',
  'end_game',
];

interface PossessionChange {
  teamId: string;
  playType: PlayType;
  quarter: number;
  playId: string;
}

function isFinal(summary: EspnSummary): boolean {
  const statusType = summary.header?.competitions?.[0]?.status?.type;
  return Boolean(statusType?.completed) || statusType?.state === 'post';
}

function flatten(summary: EspnSummary): Array<{ play: EspnPlay; drive: EspnDrive }> {
  const flattened: Array<{ play: EspnPlay; drive: EspnDrive }> = [];
  for (const drive of summary.drives?.previous ?? []) {
    for (const play of drive.plays ?? []) flattened.push({ play, drive });
  }
  const current = summary.drives?.current;
  if (current) {
    for (const play of current.plays ?? []) flattened.push({ play, drive: current });
  }
  return flattened;
}

/** Replaces global fetch for one call. `espnClient` is the only consumer. */
async function parseSummary(
  eventId: string,
  body: Buffer,
): Promise<Awaited<ReturnType<typeof espnClient.getSummary>>> {
  const previous = globalThis.fetch;
  globalThis.fetch = async () =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => JSON.parse(body.toString('utf8')) as unknown,
    }) as Response;
  try {
    return await espnClient.getSummary(eventId);
  } finally {
    globalThis.fetch = previous;
  }
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (dir === undefined || dir.startsWith('--')) {
    console.error(
      'usage: npx tsx experiments/replay-recording.ts <experiments/logs/recordings/YYYY-MM-DD/eventId>',
    );
    process.exitCode = 1;
    return;
  }

  globalThis.fetch = async () => {
    throw new Error('replay is offline');
  };

  const eventId = path.basename(dir);
  const names = (await readdir(dir)).filter((name) => name.endsWith('.json.gz')).sort();
  const seenPlayIds = new Set<string>();
  const counts = new Map<PlayType, number>();
  const changes: PossessionChange[] = [];
  let context: EspnGameContext | null = null;
  let lastPossession: string | null = null;
  let mapped = 0;
  let parsedBodies = 0;
  let lastBodyPlays = 0;

  for (const name of names) {
    const body = gunzipSync(await readFile(path.join(dir, name)));
    const result = await parseSummary(eventId, body);
    if (!result.ok) {
      console.error(`[replay] ${name} parse failed (${result.kind}): ${result.reason}`);
      continue;
    }
    parsedBodies += 1;
    const summary = result.data;
    if (context === null) {
      context = resolveGameContext(summary, eventId);
      if (context === null) {
        console.error(`[replay] ${name} missing both teams, skipping`);
        continue;
      }
    }

    const gameIsFinal = isFinal(summary);
    const flattened = flatten(summary);
    lastBodyPlays = flattened.length;
    const lastIndex = flattened.length - 1;
    for (const [index, { play, drive }] of flattened.entries()) {
      if (seenPlayIds.has(play.id)) continue;
      seenPlayIds.add(play.id);
      const event = mapEspnPlay(play, drive, context, gameIsFinal && index === lastIndex);
      mapped += 1;
      counts.set(event.playType, (counts.get(event.playType) ?? 0) + 1);
      if (event.possessionTeamId !== null && event.possessionTeamId !== lastPossession) {
        changes.push({
          teamId: event.possessionTeamId,
          playType: event.playType,
          quarter: event.quarter,
          playId: event.playId,
        });
        lastPossession = event.possessionTeamId;
      }
    }
  }

  console.log(`event ${eventId}`);
  console.log(`bodies ${names.length}  parsed ${parsedBodies}`);
  console.log(`mapped plays ${mapped}`);
  console.log(`last body plays ${lastBodyPlays}`);
  console.log('by PlayType:');
  for (const playType of PLAY_TYPES) {
    const count = counts.get(playType) ?? 0;
    if (count === 0) continue;
    console.log(`  ${playType} ${count}`);
  }
  console.log(`possession changes ${changes.length}:`);
  for (const change of changes) {
    console.log(`  ${change.teamId}  Q${change.quarter}  ${change.playType}  ${change.playId}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
