import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  CapturingEventDispatcher,
  InMemoryGameStateProvider,
  onPlayEvent,
  type PlayEvent,
} from '@pivot/engine';
import {
  espnSummarySchema,
  mapEspnPlay,
  resolveGameContext,
  type EspnDrive,
  type EspnPlay,
} from '@pivot/ingestion';
import type { FlagEvent, UserLineupCache } from '@pivot/shared';
import { describe, expect, it } from 'vitest';

const RECORDING_DIR = path.resolve(
  process.cwd(),
  'experiments/logs/recordings/2026-09-28/401872963',
);

function playsFromRecording(): PlayEvent[] {
  const file = readdirSync(RECORDING_DIR)
    .filter((name) => name.endsWith('.json.gz'))
    .sort()
    .at(-1);
  if (!file) throw new Error(`no summary in ${RECORDING_DIR}`);
  const summary = espnSummarySchema.parse(
    JSON.parse(gunzipSync(readFileSync(path.join(RECORDING_DIR, file))).toString()),
  );
  const context = resolveGameContext(summary, '401872963');
  if (!context) throw new Error('recording has no game context');

  const pairs: { play: EspnPlay; drive: EspnDrive }[] = [];
  for (const drive of summary.drives?.previous ?? []) {
    for (const play of drive.plays ?? []) pairs.push({ play, drive });
  }
  if (summary.drives?.current) {
    for (const play of summary.drives.current.plays ?? []) {
      pairs.push({ play, drive: summary.drives.current });
    }
  }
  return pairs.map((pair, index) =>
    mapEspnPlay(pair.play, pair.drive, context, index === pairs.length - 1),
  );
}

function lineup(input: { week: number; teamId: string; withUnits: boolean }): UserLineupCache {
  const cache: UserLineupCache = {
    userId: 'u-replay',
    week: input.week,
    teamPositions: new Map([[input.teamId, new Set<'offense' | 'defense'>(['offense', 'defense'])]]),
    playerToTeam: new Map([
      ['phi-te', input.teamId],
      ['phi-dst', input.teamId],
    ]),
    starPlayerIds: new Set<string>(),
  };
  if (input.withUnits) {
    cache.playerUnits = new Map([
      ['phi-te', 'offense'],
      ['phi-dst', 'defense'],
    ]);
  }
  return cache;
}

async function emit(plays: PlayEvent[], cache: UserLineupCache): Promise<FlagEvent[]> {
  const gameState = new InMemoryGameStateProvider();
  const dispatcher = new CapturingEventDispatcher();
  for (const teamId of new Set(cache.playerToTeam.values())) {
    gameState.addStake(teamId, cache.userId);
  }
  let at = 1_700_000_000_000;
  for (const play of plays) {
    at += 1000;
    const clockAt = at;
    await onPlayEvent(
      {
        lineupCache: { getLineupCache: async () => cache },
        gameState,
        dispatcher,
        clock: () => clockAt,
      },
      play,
    );
  }
  return dispatcher.events;
}

function fingerprint(events: FlagEvent[]) {
  return events.map((event) => ({
    type: event.type,
    at: event.newState.computedAt,
    flagged: event.newState.flagged,
    priority: event.newState.priorityScore,
    reasons: event.newState.reasons
      .map((reason) => `${reason.type}:${reason.triggeringPlayerIds.join(',')}`)
      .join('|'),
  }));
}

function diffByTimestamp(
  oldEvents: ReturnType<typeof fingerprint>,
  newEvents: ReturnType<typeof fingerprint>,
) {
  const oldByAt = new Map(oldEvents.map((row) => [row.at, row]));
  const newByAt = new Map(newEvents.map((row) => [row.at, row]));
  const times = [...new Set([...oldByAt.keys(), ...newByAt.keys()])].sort((a, b) => a - b);
  let sameTypeAndFlagged = 0;
  let listOnly = 0;
  let priorityOnly = 0;
  const typeOrFlagged: string[] = [];
  const onlyOld: string[] = [];
  const onlyNew: string[] = [];
  for (const at of times) {
    const oldRow = oldByAt.get(at);
    const next = newByAt.get(at);
    if (!oldRow) {
      onlyNew.push(`${next?.type}@${at}`);
      continue;
    }
    if (!next) {
      onlyOld.push(`${oldRow.type}@${at}`);
      continue;
    }
    if (oldRow.type !== next.type || oldRow.flagged !== next.flagged) {
      typeOrFlagged.push(`${at} ${oldRow.type}/${oldRow.flagged} -> ${next.type}/${next.flagged}`);
      continue;
    }
    sameTypeAndFlagged += 1;
    if (oldRow.reasons !== next.reasons) listOnly += 1;
    if (oldRow.priority !== next.priority) priorityOnly += 1;
  }
  return {
    oldEvents: oldEvents.length,
    newEvents: newEvents.length,
    sameTypeAndFlagged,
    listOnly,
    priorityOnly,
    typeOrFlagged,
    onlyOld,
    onlyNew,
  };
}

describe('PHI @ CHI 2026-09-28 flag replay', () => {
  it('keeps event type, timestamp, and flagged state when lists are filtered by side of ball', async () => {
    const plays = playsFromRecording();
    const week = plays[0]?.week ?? 0;
    const teamId = plays[0]?.awayTeamId ?? 'PHI';
    const offenseOnly = (withUnits: boolean): UserLineupCache => ({
      userId: 'u-replay',
      week,
      teamPositions: new Map([[teamId, new Set<'offense' | 'defense'>(['offense'])]]),
      playerToTeam: new Map([['phi-te', teamId]]),
      starPlayerIds: new Set<string>(),
      ...(withUnits ? { playerUnits: new Map([['phi-te', 'offense'] as const]) } : {}),
    });
    const offenseDiff = diffByTimestamp(
      fingerprint(await emit(plays, offenseOnly(false))),
      fingerprint(await emit(plays, offenseOnly(true))),
    );
    const mixedDiff = diffByTimestamp(
      fingerprint(await emit(plays, lineup({ week, teamId, withUnits: false }))),
      fingerprint(await emit(plays, lineup({ week, teamId, withUnits: true }))),
    );
    expect(plays).toHaveLength(166);
    expect(plays[0]?.awayTeamId).toBe('PHI');
    expect(plays[0]?.homeTeamId).toBe('CHI');
    expect(offenseDiff).toEqual({
      oldEvents: 20,
      newEvents: 20,
      sameTypeAndFlagged: 20,
      listOnly: 0,
      priorityOnly: 0,
      typeOrFlagged: [],
      onlyOld: [],
      onlyNew: [],
    });
    // Same-team TE + D/ST: every previous event stays at the same clock with the same type and
    // flagged bit. Lists and offense priority change, and three priority_increased rows appear
    // because the offense score is 2 lower and a later bonus now crosses +3.
    expect(mixedDiff).toEqual({
      oldEvents: 33,
      newEvents: 36,
      sameTypeAndFlagged: 33,
      listOnly: 19,
      priorityOnly: 11,
      typeOrFlagged: [],
      onlyOld: [],
      onlyNew: [
        'priority_increased@1700000035000',
        'priority_increased@1700000140000',
        'priority_increased@1700000164000',
      ],
    });
  });
});
