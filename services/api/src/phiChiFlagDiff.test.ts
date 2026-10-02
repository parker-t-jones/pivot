import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  CapturingEventDispatcher,
  InMemoryGameStateProvider,
  applyPlayToState,
  computeFlagState,
  isInterestingStateChange,
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

/** `diffFlagStates` before a reason or player change forced `flag_added`. */
function legacyDiff(
  userId: string,
  oldState: FlagEvent['newState'] | null,
  newState: FlagEvent['newState'],
): FlagEvent | null {
  const wasFlagged = oldState?.flagged ?? false;
  const isFlagged = newState.flagged;
  const make = (type: FlagEvent['type']): FlagEvent => ({
    id: createHash('sha1').update(`${userId}:${newState.gameId}:${type}:${newState.computedAt}`).digest('hex'),
    userId,
    gameId: newState.gameId,
    type,
    oldState,
    newState,
    scheduledFireAt: newState.computedAt,
  });
  if (!wasFlagged && !isFlagged) return null;
  if (!wasFlagged && isFlagged) return make('flag_added');
  if (wasFlagged && !isFlagged) return make('flag_removed');
  const delta = newState.priorityScore - (oldState?.priorityScore ?? 0);
  if (delta >= 3) return make('priority_increased');
  if (delta <= -3) return make('priority_decreased');
  return null;
}

async function emitLegacy(plays: PlayEvent[], cache: UserLineupCache): Promise<FlagEvent[]> {
  const gameState = new InMemoryGameStateProvider();
  for (const teamId of new Set(cache.playerToTeam.values())) {
    gameState.addStake(teamId, cache.userId);
  }
  const events: FlagEvent[] = [];
  let at = 1_700_000_000_000;
  for (const play of plays) {
    at += 1000;
    const clockAt = at;
    const oldState = await gameState.getGameState(play.gameId);
    const newState = applyPlayToState(oldState, play, () => clockAt);
    await gameState.setGameState(play.gameId, newState);
    if (!isInterestingStateChange(oldState, newState)) continue;
    const stakeholders = new Set([
      ...(await gameState.getUsersWithStakeIn(newState.homeTeamId)),
      ...(await gameState.getUsersWithStakeIn(newState.awayTeamId)),
    ]);
    for (const userId of stakeholders) {
      const oldFlag = await gameState.getUserFlagState(userId, play.gameId);
      const newFlag = computeFlagState(cache, newState, () => clockAt);
      const event = legacyDiff(userId, oldFlag, newFlag);
      if (!event) continue;
      await gameState.setUserFlagState(userId, play.gameId, newFlag);
      events.push(event);
    }
  }
  return events;
}

function countTypes(events: { type: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1;
  return counts;
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
    const bothTeams = (withUnits: boolean): UserLineupCache => ({
      userId: 'u-replay',
      week,
      teamPositions: new Map([
        [teamId, new Set<'offense' | 'defense'>(['offense'])],
        [plays[0]?.homeTeamId ?? 'CHI', new Set<'offense' | 'defense'>(['offense'])],
      ]),
      playerToTeam: new Map([
        ['phi-te', teamId],
        ['chi-wr', plays[0]?.homeTeamId ?? 'CHI'],
      ]),
      starPlayerIds: new Set<string>(),
      ...(withUnits
        ? {
            playerUnits: new Map([
              ['phi-te', 'offense'] as const,
              ['chi-wr', 'offense'] as const,
            ]),
          }
        : {}),
    });
    const lineups = {
      phiOffense: offenseOnly(true),
      phiTeAndDst: lineup({ week, teamId, withUnits: true }),
      phiAndChi: bothTeams(true),
    };
    const summaries: Record<string, unknown> = {};
    for (const [name, cache] of Object.entries(lineups)) {
      const before = fingerprint(await emitLegacy(plays, cache));
      const after = fingerprint(await emit(plays, cache));
      const aligned = diffByTimestamp(before, after);
      const added: Record<string, number> = {};
      const removed: Record<string, number> = {};
      for (const label of aligned.onlyNew) {
        const type = label.split('@')[0] ?? label;
        added[type] = (added[type] ?? 0) + 1;
      }
      for (const label of aligned.onlyOld) {
        const type = label.split('@')[0] ?? label;
        removed[type] = (removed[type] ?? 0) + 1;
      }
      const retyped: Record<string, number> = {};
      for (const row of aligned.typeOrFlagged) {
        const match = /^(\d+) (\w+)\/(true|false) -> (\w+)\/(true|false)$/.exec(row);
        expect(match?.[3]).toBe(match?.[5]);
        const label = `${match?.[2]} -> ${match?.[4]}`;
        retyped[label] = (retyped[label] ?? 0) + 1;
      }
      summaries[name] = {
        before: countTypes(before),
        after: countTypes(after),
        added,
        removed,
        retyped,
      };
    }
    expect(summaries).toEqual({
      phiOffense: {
        before: { flag_added: 9, flag_removed: 9, priority_increased: 2 },
        after: { flag_added: 11, flag_removed: 9 },
        added: {},
        removed: {},
        retyped: { 'priority_increased -> flag_added': 2 },
      },
      phiTeAndDst: {
        before: { flag_added: 14, priority_increased: 7, flag_removed: 14, priority_decreased: 1 },
        after: { flag_added: 24, flag_removed: 14 },
        added: { flag_added: 2 },
        removed: {},
        retyped: {
          'priority_increased -> flag_added': 7,
          'priority_decreased -> flag_added': 1,
        },
      },
      phiAndChi: {
        before: { flag_added: 14, priority_increased: 7, flag_removed: 14, priority_decreased: 1 },
        after: { flag_added: 24, flag_removed: 14 },
        added: { flag_added: 2 },
        removed: {},
        retyped: {
          'priority_increased -> flag_added': 7,
          'priority_decreased -> flag_added': 1,
        },
      },
    });
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
    expect(mixedDiff).toEqual({
      oldEvents: 38,
      newEvents: 38,
      sameTypeAndFlagged: 38,
      listOnly: 24,
      priorityOnly: 11,
      typeOrFlagged: [],
      onlyOld: [],
      onlyNew: [],
    });
  });
});
