import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  countSummaryPlays,
  summaryPlayPrefixes,
  writeSummaryPlayPrefixes,
} from './summaryPlayPrefixes.js';

const summary = {
  header: { competitions: [{ status: { type: { state: 'in', completed: false } } }] },
  drives: {
    previous: [
      {
        team: { abbreviation: 'IND' },
        plays: [{ id: 'p1' }, { id: 'p2' }],
      },
    ],
    current: {
      team: { abbreviation: 'KC' },
      plays: [{ id: 'p3' }, { id: 'p4' }],
    },
  },
};

function playIds(body: unknown): string[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return [];
  const drives = (body as Record<string, unknown>)['drives'];
  if (typeof drives !== 'object' || drives === null || Array.isArray(drives)) return [];
  const record = drives as Record<string, unknown>;
  const ids: string[] = [];
  const previous = record['previous'];
  if (Array.isArray(previous)) {
    for (const drive of previous) {
      if (typeof drive !== 'object' || drive === null || Array.isArray(drive)) continue;
      const plays = (drive as Record<string, unknown>)['plays'];
      if (!Array.isArray(plays)) continue;
      for (const play of plays) {
        if (typeof play === 'object' && play !== null && 'id' in play) {
          ids.push(String((play as { id: unknown }).id));
        }
      }
    }
  }
  const current = record['current'];
  if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
    const plays = (current as Record<string, unknown>)['plays'];
    if (Array.isArray(plays)) {
      for (const play of plays) {
        if (typeof play === 'object' && play !== null && 'id' in play) {
          ids.push(String((play as { id: unknown }).id));
        }
      }
    }
  }
  return ids;
}

describe('summaryPlayPrefixes', () => {
  it('writes three gzipped prefixes with play counts 1, 2, 3 in poll order', async () => {
    const bodies = summaryPlayPrefixes(summary, 3);
    expect(bodies.map(countSummaryPlays)).toEqual([1, 2, 3]);
    expect(bodies.map(playIds)).toEqual([['p1'], ['p1', 'p2'], ['p1', 'p2', 'p3']]);
    expect(countSummaryPlays(summary)).toBe(4);

    const directory = await mkdtemp(path.join(tmpdir(), 'summary-play-prefixes-'));
    try {
      await writeSummaryPlayPrefixes({
        body: summary,
        directory,
        prefixCount: 3,
        baseReceivedAt: new Date('2026-09-13T16:47:50.000Z'),
      });
      const names = (await readdir(directory)).filter((name) => name.endsWith('.json.gz')).sort();
      expect(names).toEqual([
        '2026-09-13T16:47:50.000Z.json.gz',
        '2026-09-13T16:47:55.000Z.json.gz',
        '2026-09-13T16:48:00.000Z.json.gz',
      ]);
      const counts: number[] = [];
      for (const name of names) {
        const raw = gunzipSync(await readFile(path.join(directory, name)));
        counts.push(countSummaryPlays(JSON.parse(raw.toString('utf8')) as unknown));
      }
      expect(counts).toEqual([1, 2, 3]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
