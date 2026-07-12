import { describe, expect, it } from 'vitest';
import type { FlagEvent, FlagState } from '@fantasy-focus/shared';
import { InMemoryBroadcastCatalog } from './broadcastLag.js';
import {
  InMemoryFlagEventPersistence,
  InMemoryGameCatalog,
  InMemoryPlayerCatalog,
  InMemoryUserDirectory,
  type DispatchUser,
} from './catalogs.js';
import { deliverFlagEvent, type DeliveryDeps, type FlagEventEnvelope } from './delivery.js';
import { InMemoryGameStateStore } from './providers/inMemoryGameStateStore.js';
import { InMemoryRateLimitStore } from './rateLimiter.js';
import { InMemoryRealtimeBus, realtimeUserChannel } from './realtimeBus.js';

function makeFlagState(overrides: Partial<FlagState> = {}): FlagState {
  return {
    gameId: 'g1',
    flagged: true,
    priorityScore: 10,
    reasons: [{ type: 'offense_active', triggeringPlayerIds: ['p1', 'p2'] }],
    computedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<FlagEvent> = {}): FlagEvent {
  return {
    id: 'evt-1',
    userId: 'u1',
    gameId: 'g1',
    type: 'flag_added',
    oldState: null,
    newState: makeFlagState(),
    scheduledFireAt: 1_700_000_060_000,
    ...overrides,
  };
}

const freeUser: DispatchUser = {
  id: 'u1',
  subscriptionTier: 'free',
  preferences: {
    notificationMode: 'all',
    quietHours: { enabled: false, startHour: 22, endHour: 8, timezone: 'America/New_York' },
    autoSwitch: false,
  },
};

function buildDeps(overrides: Partial<DeliveryDeps> = {}): DeliveryDeps {
  return {
    gameStateStore: new InMemoryGameStateStore(),
    gameCatalog: new InMemoryGameCatalog(),
    playerCatalog: new InMemoryPlayerCatalog(),
    broadcastCatalog: new InMemoryBroadcastCatalog(),
    userDirectory: new InMemoryUserDirectory(),
    persistence: new InMemoryFlagEventPersistence(),
    realtimeBus: new InMemoryRealtimeBus(),
    rateLimitStore: new InMemoryRateLimitStore(),
    clock: () => 1_700_000_061_500,
    ...overrides,
  };
}

describe('deliverFlagEvent', () => {
  it('persists to flag_events with firedAt=scheduledFireAt and deliveredAt=now, no play id', async () => {
    const persistence = new InMemoryFlagEventPersistence();
    const deps = buildDeps({ persistence });

    await deliverFlagEvent(deps, makeEvent(), freeUser);

    expect(persistence.records).toEqual([
      {
        id: 'evt-1',
        userId: 'u1',
        gameId: 'g1',
        eventType: 'flag_added',
        triggeringPlayId: null,
        priorityScore: 10,
        reasons: makeFlagState().reasons,
        firedAt: 1_700_000_060_000,
        deliveredAt: 1_700_000_061_500,
      },
    ]);
  });

  it('publishes the Section 9 envelope to realtime:user:{userId}', async () => {
    const bus = new InMemoryRealtimeBus();
    const deps = buildDeps({ realtimeBus: bus });

    await deliverFlagEvent(deps, makeEvent(), freeUser);

    expect(bus.published).toHaveLength(1);
    expect(bus.published[0]?.channel).toBe(realtimeUserChannel('u1'));
    const envelope = bus.published[0]?.message as FlagEventEnvelope;
    expect(envelope.id).toBe('evt-1');
    expect(envelope.type).toBe('flag_event');
    expect(envelope.timestamp).toBe(1_700_000_061_500);
    expect(envelope.payload.user_id).toBe('u1');
    expect(envelope.payload.game_id).toBe('g1');
    expect(envelope.payload.event_type).toBe('flag_added');
  });

  it('records the delivery into the rate-limit sliding window (decision #8)', async () => {
    const rateLimitStore = new InMemoryRateLimitStore();
    const deps = buildDeps({ rateLimitStore });

    await deliverFlagEvent(deps, makeEvent(), freeUser);

    expect(rateLimitStore.entriesFor('u1')).toEqual([
      { eventId: 'evt-1', deliveredAtMs: 1_700_000_061_500 },
    ]);
  });

  it('enriches the action with recommended_source/deep_link_url from the broadcast catalog', async () => {
    const broadcastCatalog = new InMemoryBroadcastCatalog();
    broadcastCatalog.setGameBroadcasts('g1', [
      { service: 'fox', deepLinkUrl: 'https://fox.example/g1', requiresSubscription: false },
    ]);
    broadcastCatalog.setUserSubscribedServices('u1', ['fox']);
    const bus = new InMemoryRealtimeBus();
    const deps = buildDeps({ broadcastCatalog, realtimeBus: bus });

    await deliverFlagEvent(deps, makeEvent(), freeUser);

    const envelope = bus.published[0]?.message as FlagEventEnvelope;
    expect(envelope.payload.action.recommended_source).toBe('fox');
    expect(envelope.payload.action.deep_link_url).toBe('https://fox.example/g1');
  });

  it('leaves recommended_source/deep_link_url null when no broadcast resolves', async () => {
    const bus = new InMemoryRealtimeBus();
    const deps = buildDeps({ realtimeBus: bus });

    await deliverFlagEvent(deps, makeEvent(), freeUser);

    const envelope = bus.published[0]?.message as FlagEventEnvelope;
    expect(envelope.payload.action.recommended_source).toBeNull();
    expect(envelope.payload.action.deep_link_url).toBeNull();
  });

  it('builds game_summary from GameState + GameCatalog team abbreviations', async () => {
    const gameStateStore = new InMemoryGameStateStore();
    await gameStateStore.setGameState('g1', {
      gameId: 'g1',
      homeTeamId: 'team-lv',
      awayTeamId: 'team-kc',
      possessionTeamId: 'team-kc',
      unitOnField: 'offense',
      scoreHome: 14,
      scoreAway: 21,
      quarter: 3,
      timeRemainingSec: 300,
      inRedZone: true,
      status: 'in_progress',
      updatedAt: 1_700_000_050_000,
    });
    const gameCatalog = new InMemoryGameCatalog();
    gameCatalog.setGame('g1', { homeTeamAbbreviation: 'LV', awayTeamAbbreviation: 'KC' });
    const bus = new InMemoryRealtimeBus();
    const deps = buildDeps({ gameStateStore, gameCatalog, realtimeBus: bus });

    await deliverFlagEvent(deps, makeEvent(), freeUser);

    const envelope = bus.published[0]?.message as FlagEventEnvelope;
    expect(envelope.payload.game_summary).toEqual({
      home_team: 'LV',
      away_team: 'KC',
      score: { home: 14, away: 21 },
      quarter: 3,
      time_remaining_sec: 300,
    });
  });

  it('falls back to raw team ids for game_summary when the catalog has no entry', async () => {
    const gameStateStore = new InMemoryGameStateStore();
    await gameStateStore.setGameState('g1', {
      gameId: 'g1',
      homeTeamId: 'team-lv',
      awayTeamId: 'team-kc',
      possessionTeamId: 'team-kc',
      unitOnField: 'offense',
      scoreHome: 0,
      scoreAway: 0,
      quarter: 1,
      timeRemainingSec: 900,
      inRedZone: false,
      status: 'in_progress',
      updatedAt: 1_700_000_050_000,
    });
    const bus = new InMemoryRealtimeBus();
    const deps = buildDeps({ gameStateStore, realtimeBus: bus }); // no InMemoryGameCatalog entry set

    await deliverFlagEvent(deps, makeEvent(), freeUser);

    const envelope = bus.published[0]?.message as FlagEventEnvelope;
    expect(envelope.payload.game_summary.home_team).toBe('team-lv');
    expect(envelope.payload.game_summary.away_team).toBe('team-kc');
  });

  it('resolves flagged_players from the deduplicated triggeringPlayerIds across all reasons', async () => {
    const playerCatalog = new InMemoryPlayerCatalog();
    playerCatalog.setPlayer({
      playerId: 'p1',
      firstName: 'Jonathan',
      lastName: 'Taylor',
      position: 'RB',
    });
    playerCatalog.setPlayer({
      playerId: 'p2',
      firstName: 'Michael',
      lastName: 'Pittman',
      position: 'WR',
    });
    const bus = new InMemoryRealtimeBus();
    const event = makeEvent({
      newState: makeFlagState({
        reasons: [
          { type: 'offense_active', triggeringPlayerIds: ['p1', 'p2'] },
          { type: 'star_player_active', triggeringPlayerIds: ['p1'] }, // p1 duplicated across reasons
        ],
      }),
    });
    const deps = buildDeps({ playerCatalog, realtimeBus: bus });

    await deliverFlagEvent(deps, event, freeUser);

    const envelope = bus.published[0]?.message as FlagEventEnvelope;
    expect(envelope.payload.flagged_players).toHaveLength(2);
    expect(envelope.payload.flagged_players).toEqual(
      expect.arrayContaining([
        { player_id: 'p1', first_name: 'Jonathan', last_name: 'Taylor', position: 'RB' },
        { player_id: 'p2', first_name: 'Michael', last_name: 'Pittman', position: 'WR' },
      ]),
    );
  });

  it('reflects the viewing session + user in the decided action (e.g. auto_switch)', async () => {
    const userDirectory = new InMemoryUserDirectory();
    userDirectory.setViewingSession('u1', { primaryGameId: 'g2', primaryPriorityScore: 3 });
    const bus = new InMemoryRealtimeBus();
    const autoSwitchUser: DispatchUser = {
      ...freeUser,
      preferences: { ...freeUser.preferences, autoSwitch: true },
    };
    const deps = buildDeps({ userDirectory, realtimeBus: bus });

    await deliverFlagEvent(
      deps,
      makeEvent({ newState: makeFlagState({ priorityScore: 10 }) }),
      autoSwitchUser,
    );

    const envelope = bus.published[0]?.message as FlagEventEnvelope;
    expect(envelope.payload.action.type).toBe('auto_switch');
    expect(envelope.payload.action.cta).toBeNull();
  });
});
