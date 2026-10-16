import { describe, expect, it, vi } from 'vitest';
import type { FlagEvent, FlagState } from '@pivot/shared';
import { InMemoryBroadcastCatalog } from './broadcastLag.js';
import {
  InMemoryFlagEventPersistence,
  InMemoryGameCatalog,
  InMemoryPlayerCatalog,
  InMemoryUserDirectory,
  type DispatchUser,
} from './catalogs.js';
import { deliverFlagEvent, type DeliveryDeps, type FlagEventEnvelope } from './delivery.js';
import { PUSH_RELEVANCE_MS, PUSH_RETRY_BACKOFF_MS, retryPendingPushes } from './pushRetry.js';
import { notificationBody, notificationTitle } from './notificationContent.js';
import { CapturingPushNotifier, type PushPayload } from './pushNotifier.js';
import {
  CapturingWebPushSender,
  InMemoryWebPushSubscriptionStore,
  WEB_PUSH_TTL_SECONDS,
  webPushCollapseKey,
} from './webPush.js';
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
    watchOpponent: false,
    watchedLeagueIds: [],
  },
  // No token by default — most of these tests predate push and shouldn't inadvertently exercise it.
  // The "push" describe block below builds its own user fixture with a token set.
  expoPushToken: null,
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
    pushNotifier: new CapturingPushNotifier(),
    clock: () => 1_700_000_061_500,
    ...overrides,
  };
}

/** `g1` is one of two Sunday 1pm FOX games (a regional slate); u1 has `services`. */
function weekCatalog(services: string[]): InMemoryBroadcastCatalog {
  const fox = {
    network: 'fox' as const,
    market: 'national' as const,
    espnMediaName: 'FOX',
    espnType: 'TV',
  };
  const kickoff = new Date('2026-09-27T17:00:00Z');
  const catalog = new InMemoryBroadcastCatalog();
  catalog.setWeekAirings([
    { id: 'g1', kickoff, airings: [fox] },
    { id: 'g2', kickoff, airings: [fox] },
  ]);
  catalog.setUserSubscribedServices('u1', services);
  return catalog;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('deliverFlagEvent', () => {
  it('persists a uuid row id with firedAt=scheduledFireAt and deliveredAt=now', async () => {
    const persistence = new InMemoryFlagEventPersistence();
    const deps = buildDeps({ persistence });

    await deliverFlagEvent(deps, makeEvent(), freeUser);

    expect(persistence.records).toHaveLength(1);
    expect(persistence.records[0]?.id).toMatch(UUID_RE);
    expect(persistence.records[0]).toMatchObject({
      userId: 'u1',
      gameId: 'g1',
      eventType: 'flag_added',
      triggeringPlayId: null,
      priorityScore: 10,
      reasons: makeFlagState().reasons,
      firedAt: 1_700_000_060_000,
      deliveredAt: 1_700_000_061_500,
    });
  });

  it('inserts one row for a play and does not notify again on the same key', async () => {
    const persistence = new InMemoryFlagEventPersistence();
    const bus = new InMemoryRealtimeBus();
    const pushNotifier = new CapturingPushNotifier();
    const rateLimitStore = new InMemoryRateLimitStore();
    const deps = buildDeps({ persistence, realtimeBus: bus, pushNotifier, rateLimitStore });
    const pushUser: DispatchUser = { ...freeUser, expoPushToken: 'ExponentPushToken[dedupe]' };
    const playId = '401772510-9';

    const first = await deliverFlagEvent(deps, makeEvent(), pushUser, playId);
    const second = await deliverFlagEvent(deps, makeEvent({ id: 'evt-2' }), pushUser, playId);

    expect(first).toBe('inserted');
    expect(second).toBe('duplicate');
    expect(persistence.records).toHaveLength(1);
    expect(persistence.records[0]?.id).toMatch(UUID_RE);
    expect(persistence.records[0]?.triggeringPlayId).toBe(playId);
    expect(bus.published).toHaveLength(1);
    expect(pushNotifier.calls).toHaveLength(1);
    expect(rateLimitStore.entriesFor('u1')).toHaveLength(1);
  });

  it('publishes the Section 9 envelope to realtime:user:{userId}', async () => {
    const persistence = new InMemoryFlagEventPersistence();
    const bus = new InMemoryRealtimeBus();
    const deps = buildDeps({ persistence, realtimeBus: bus });

    await deliverFlagEvent(deps, makeEvent(), freeUser);

    expect(bus.published).toHaveLength(1);
    expect(bus.published[0]?.channel).toBe(realtimeUserChannel('u1'));
    const envelope = bus.published[0]?.message as FlagEventEnvelope;
    const rowId = persistence.records[0]?.id;
    expect(rowId).toMatch(UUID_RE);
    expect(envelope.id).toBe(rowId);
    expect(envelope.type).toBe('flag_event');
    expect(envelope.timestamp).toBe(1_700_000_061_500);
    expect(envelope.payload.event_id).toBe(rowId);
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

  it('recommends the top-ranked option and its landing URL', async () => {
    const broadcastCatalog = weekCatalog(['youtube_tv']);
    const bus = new InMemoryRealtimeBus();
    const gameCatalog = new InMemoryGameCatalog();
    gameCatalog.setGame('g1', {
      homeTeamAbbreviation: 'GB',
      awayTeamAbbreviation: 'ATL',
      homeTeamName: 'Packers',
      awayTeamName: 'Falcons',
      homeTeamPrimaryColor: '#203731',
      homeTeamSecondaryColor: '#FFB612',
      awayTeamPrimaryColor: '#A71930',
      awayTeamSecondaryColor: '#000000',
    });
    const deps = buildDeps({ broadcastCatalog, realtimeBus: bus, gameCatalog });

    await deliverFlagEvent(deps, makeEvent(), freeUser);

    const envelope = bus.published[0]?.message as FlagEventEnvelope;
    expect(envelope.payload.action.recommended_source).toBe('youtube_tv');
    expect(envelope.payload.action.deep_link_url).toBe(
      'https://tv.youtube.com/search/Falcons%20vs%20Packers%20today',
    );
  });

  it('recommends Sunday Ticket over YouTube TV on a regional FOX game', async () => {
    const broadcastCatalog = weekCatalog(['youtube_tv', 'sunday_ticket']);
    const bus = new InMemoryRealtimeBus();
    const gameCatalog = new InMemoryGameCatalog();
    gameCatalog.setGame('g1', {
      homeTeamAbbreviation: 'GB',
      awayTeamAbbreviation: 'ATL',
      homeTeamName: 'Packers',
      awayTeamName: 'Falcons',
      homeTeamPrimaryColor: '#203731',
      homeTeamSecondaryColor: '#FFB612',
      awayTeamPrimaryColor: '#A71930',
      awayTeamSecondaryColor: '#000000',
    });
    const deps = buildDeps({ broadcastCatalog, realtimeBus: bus, gameCatalog });

    await deliverFlagEvent(deps, makeEvent(), freeUser);

    const envelope = bus.published[0]?.message as FlagEventEnvelope;
    expect(envelope.payload.action.recommended_source).toBe('sunday_ticket');
    expect(envelope.payload.action.deep_link_url).toBe(
      'https://tv.youtube.com/search/Falcons%20vs%20Packers%20NFL%20ST%20today',
    );
  });

  it('leaves recommended_source/deep_link_url null when the user has no carrying service', async () => {
    const broadcastCatalog = weekCatalog(['amazon_prime']);
    const bus = new InMemoryRealtimeBus();
    const deps = buildDeps({ broadcastCatalog, realtimeBus: bus });

    await deliverFlagEvent(deps, makeEvent(), freeUser);

    const envelope = bus.published[0]?.message as FlagEventEnvelope;
    expect(envelope.payload.action.recommended_source).toBeNull();
    expect(envelope.payload.action.deep_link_url).toBeNull();
  });

  it('leaves recommended_source/deep_link_url null when the game has no airings', async () => {
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
      yardsToOpponentEndzone: null,
      down: null,
      distance: null,
      inRedZone: true,
      status: 'in_progress',
      updatedAt: 1_700_000_050_000,
    });
    const gameCatalog = new InMemoryGameCatalog();
    gameCatalog.setGame('g1', {
      homeTeamAbbreviation: 'LV',
      awayTeamAbbreviation: 'KC',
      homeTeamName: 'Raiders',
      awayTeamName: 'Chiefs',
      homeTeamPrimaryColor: '#000000',
      homeTeamSecondaryColor: '#A5ACAF',
      awayTeamPrimaryColor: '#E31837',
      awayTeamSecondaryColor: '#FFB81C',
    });
    const bus = new InMemoryRealtimeBus();
    const deps = buildDeps({ gameStateStore, gameCatalog, realtimeBus: bus });

    await deliverFlagEvent(deps, makeEvent(), freeUser);

    const envelope = bus.published[0]?.message as FlagEventEnvelope;
    expect(envelope.payload.game_summary).toEqual({
      home_team: 'LV',
      away_team: 'KC',
      home_team_name: 'Raiders',
      away_team_name: 'Chiefs',
      home_team_primary_color: '#000000',
      home_team_secondary_color: '#A5ACAF',
      away_team_primary_color: '#E31837',
      away_team_secondary_color: '#FFB81C',
      score: { home: 14, away: 21 },
      quarter: 3,
      time_remaining_sec: 300,
      possession_team: 'KC',
      yards_to_endzone: null,
      down: null,
      distance: null,
      in_red_zone: true,
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
      yardsToOpponentEndzone: null,
      down: null,
      distance: null,
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

  describe('possession_team (Sprint 9 Phase 1)', () => {
    it('populates new_state.possession_team with the abbreviation of the possessing team', async () => {
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
        yardsToOpponentEndzone: null,
        down: null,
        distance: null,
        inRedZone: false,
        status: 'in_progress',
        updatedAt: 0,
      });
      const gameCatalog = new InMemoryGameCatalog();
      gameCatalog.setGame('g1', {
        homeTeamAbbreviation: 'LV',
        awayTeamAbbreviation: 'KC',
        homeTeamName: 'Raiders',
        awayTeamName: 'Chiefs',
        homeTeamPrimaryColor: '#000000',
        homeTeamSecondaryColor: '#A5ACAF',
        awayTeamPrimaryColor: '#E31837',
        awayTeamSecondaryColor: '#FFB81C',
      });
      const bus = new InMemoryRealtimeBus();
      const deps = buildDeps({ gameStateStore, gameCatalog, realtimeBus: bus });

      await deliverFlagEvent(deps, makeEvent(), freeUser);

      const envelope = bus.published[0]?.message as FlagEventEnvelope;
      expect(envelope.payload.new_state.possession_team).toBe('KC');
    });

    it('resolves the HOME team abbreviation when the home team has possession', async () => {
      const gameStateStore = new InMemoryGameStateStore();
      await gameStateStore.setGameState('g1', {
        gameId: 'g1',
        homeTeamId: 'team-lv',
        awayTeamId: 'team-kc',
        possessionTeamId: 'team-lv',
        unitOnField: 'offense',
        scoreHome: 14,
        scoreAway: 21,
        quarter: 3,
        timeRemainingSec: 300,
        yardsToOpponentEndzone: null,
        down: null,
        distance: null,
        inRedZone: false,
        status: 'in_progress',
        updatedAt: 0,
      });
      const gameCatalog = new InMemoryGameCatalog();
      gameCatalog.setGame('g1', {
        homeTeamAbbreviation: 'LV',
        awayTeamAbbreviation: 'KC',
        homeTeamName: 'Raiders',
        awayTeamName: 'Chiefs',
        homeTeamPrimaryColor: '#000000',
        homeTeamSecondaryColor: '#A5ACAF',
        awayTeamPrimaryColor: '#E31837',
        awayTeamSecondaryColor: '#FFB81C',
      });
      const bus = new InMemoryRealtimeBus();
      const deps = buildDeps({ gameStateStore, gameCatalog, realtimeBus: bus });

      await deliverFlagEvent(deps, makeEvent(), freeUser);

      const envelope = bus.published[0]?.message as FlagEventEnvelope;
      expect(envelope.payload.new_state.possession_team).toBe('LV');
    });

    it('is null when the game has no possession set (special teams / between plays)', async () => {
      const gameStateStore = new InMemoryGameStateStore();
      await gameStateStore.setGameState('g1', {
        gameId: 'g1',
        homeTeamId: 'team-lv',
        awayTeamId: 'team-kc',
        possessionTeamId: null,
        unitOnField: 'none',
        scoreHome: 14,
        scoreAway: 21,
        quarter: 3,
        timeRemainingSec: 300,
        yardsToOpponentEndzone: null,
        down: null,
        distance: null,
        inRedZone: false,
        status: 'in_progress',
        updatedAt: 0,
      });
      const bus = new InMemoryRealtimeBus();
      const deps = buildDeps({ gameStateStore, realtimeBus: bus });

      await deliverFlagEvent(deps, makeEvent(), freeUser);

      const envelope = bus.published[0]?.message as FlagEventEnvelope;
      expect(envelope.payload.new_state.possession_team).toBeNull();
    });

    it('is null when there is no live GameState at all', async () => {
      const bus = new InMemoryRealtimeBus();
      const deps = buildDeps({ realtimeBus: bus }); // default InMemoryGameStateStore has no entry

      await deliverFlagEvent(deps, makeEvent(), freeUser);

      const envelope = bus.published[0]?.message as FlagEventEnvelope;
      expect(envelope.payload.new_state.possession_team).toBeNull();
    });

    it('old_state.possession_team is unconditionally null, even when new_state resolves a possessing team (ruling: no best-effort snapshot)', async () => {
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
        yardsToOpponentEndzone: null,
        down: null,
        distance: null,
        inRedZone: false,
        status: 'in_progress',
        updatedAt: 0,
      });
      const gameCatalog = new InMemoryGameCatalog();
      gameCatalog.setGame('g1', {
        homeTeamAbbreviation: 'LV',
        awayTeamAbbreviation: 'KC',
        homeTeamName: 'Raiders',
        awayTeamName: 'Chiefs',
        homeTeamPrimaryColor: '#000000',
        homeTeamSecondaryColor: '#A5ACAF',
        awayTeamPrimaryColor: '#E31837',
        awayTeamSecondaryColor: '#FFB81C',
      });
      const bus = new InMemoryRealtimeBus();
      const deps = buildDeps({ gameStateStore, gameCatalog, realtimeBus: bus });
      const event = makeEvent({ oldState: makeFlagState({ flagged: false, priorityScore: 0 }) });

      await deliverFlagEvent(deps, event, freeUser);

      const envelope = bus.published[0]?.message as FlagEventEnvelope;
      expect(envelope.payload.new_state.possession_team).toBe('KC');
      expect(envelope.payload.old_state?.possession_team).toBeNull();
    });

    it('old_state is null when the event has no oldState', async () => {
      const bus = new InMemoryRealtimeBus();
      const deps = buildDeps({ realtimeBus: bus });
      const event = makeEvent({ oldState: null });

      await deliverFlagEvent(deps, event, freeUser);

      const envelope = bus.published[0]?.message as FlagEventEnvelope;
      expect(envelope.payload.old_state).toBeNull();
    });
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
    const gameStateStore = new InMemoryGameStateStore();
    await gameStateStore.markUserActive('u1', 60_000);
    const bus = new InMemoryRealtimeBus();
    const autoSwitchUser: DispatchUser = {
      ...freeUser,
      preferences: { ...freeUser.preferences, autoSwitch: true },
    };
    const deps = buildDeps({ userDirectory, realtimeBus: bus, gameStateStore });

    await deliverFlagEvent(
      deps,
      makeEvent({ newState: makeFlagState({ priorityScore: 10 }) }),
      autoSwitchUser,
    );

    const envelope = bus.published[0]?.message as FlagEventEnvelope;
    expect(envelope.payload.action.type).toBe('auto_switch');
    expect(envelope.payload.action.cta).toBeNull();
  });

  describe('push (Sprint 6 Phase 3)', () => {
    const TOKEN = 'ExponentPushToken[test-token-000000000]';
    const pushUser: DispatchUser = { ...freeUser, expoPushToken: TOKEN };

    function gameCatalogWithNames(): InMemoryGameCatalog {
      const catalog = new InMemoryGameCatalog();
      catalog.setGame('g1', {
        homeTeamAbbreviation: 'IND',
        awayTeamAbbreviation: 'DEN',
        homeTeamName: 'Colts',
        awayTeamName: 'Broncos',
        homeTeamPrimaryColor: '#002C5F',
        homeTeamSecondaryColor: '#A2AAAD',
        awayTeamPrimaryColor: '#FB4F14',
        awayTeamSecondaryColor: '#002244',
      });
      return catalog;
    }

    async function setPossessingHomeGameState(
      gameStateStore: InMemoryGameStateStore,
    ): Promise<void> {
      await gameStateStore.setGameState('g1', {
        gameId: 'g1',
        homeTeamId: 'team-ind',
        awayTeamId: 'team-den',
        possessionTeamId: 'team-ind',
        unitOnField: 'offense',
        scoreHome: 7,
        scoreAway: 0,
        quarter: 2,
        timeRemainingSec: 434,
        yardsToOpponentEndzone: null,
        down: null,
        distance: null,
        inRedZone: false,
        status: 'in_progress',
        updatedAt: 0,
      });
    }

    it('sends push when the user has a token and the action is not in_app_indicator', async () => {
      const pushNotifier = new CapturingPushNotifier();
      const gameStateStore = new InMemoryGameStateStore();
      await setPossessingHomeGameState(gameStateStore);
      const deps = buildDeps({ pushNotifier, gameStateStore, gameCatalog: gameCatalogWithNames() });

      await deliverFlagEvent(deps, makeEvent(), pushUser);

      expect(pushNotifier.calls).toHaveLength(1);
      expect(pushNotifier.calls[0]?.token).toBe(TOKEN);
    });

    it.each(['flag_removed', 'priority_increased', 'priority_decreased'] as const)(
      'persists and publishes %s with no push and no rate-limit hit',
      async (type) => {
        const pushNotifier = new CapturingPushNotifier();
        const persistence = new InMemoryFlagEventPersistence();
        const realtimeBus = new InMemoryRealtimeBus();
        const rateLimitStore = new InMemoryRateLimitStore();
        const deps = buildDeps({ pushNotifier, persistence, realtimeBus, rateLimitStore });

        await deliverFlagEvent(deps, makeEvent({ type }), pushUser);

        expect(persistence.records).toHaveLength(1);
        expect(persistence.records[0]?.eventType).toBe(type);
        expect(realtimeBus.published).toHaveLength(1);
        expect(pushNotifier.calls).toHaveLength(0);
        expect(rateLimitStore.entriesFor('u1')).toEqual([]);
      },
    );

    it('does NOT send push when the user has no expo_push_token', async () => {
      const pushNotifier = new CapturingPushNotifier();
      const deps = buildDeps({ pushNotifier });

      await deliverFlagEvent(deps, makeEvent(), freeUser); // freeUser.expoPushToken is null

      expect(pushNotifier.calls).toHaveLength(0);
    });

    it('does NOT send push when the user is in the app and this game is already primary', async () => {
      const pushNotifier = new CapturingPushNotifier();
      const userDirectory = new InMemoryUserDirectory();
      const gameStateStore = new InMemoryGameStateStore();
      const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      userDirectory.setViewingSession('u1', { primaryGameId: 'g1', primaryPriorityScore: 5 });
      await gameStateStore.markUserActive('u1', 60_000);
      const deps = buildDeps({ pushNotifier, userDirectory, gameStateStore });

      await deliverFlagEvent(deps, makeEvent(), pushUser);

      expect(pushNotifier.calls).toHaveLength(0);
      expect(logs.mock.calls.map((call) => call[0])).toContain(
        '[dispatcher] push decision user=u1 game=g1 flag=evt-1 result=skipped_primary_connected anchor_play=- play_wallclock=- seen_at=- enqueued_at=- sent_at=- post_lag_ms=- send_lag_ms=-',
      );
      logs.mockRestore();
    });

    it('sends the iOS push when the phone is backgrounded and a web tab is visible', async () => {
      const pushNotifier = new CapturingPushNotifier();
      const userDirectory = new InMemoryUserDirectory();
      const gameStateStore = new InMemoryGameStateStore();
      const webDevice = '22222222-2222-4222-8222-222222222222';
      userDirectory.setViewingSession('u1', { primaryGameId: 'g1', primaryPriorityScore: 5 });
      await gameStateStore.markConnectionActive(
        {
          userId: 'u1',
          deviceId: webDevice,
          connectionId: 'web',
          platform: 'web',
          visibility: 'visible',
        },
        60_000,
      );
      const deps = buildDeps({ pushNotifier, userDirectory, gameStateStore });

      await deliverFlagEvent(deps, makeEvent(), pushUser);

      expect(pushNotifier.calls).toHaveLength(1);
      expect(await gameStateStore.isDeviceActive('u1', 'legacy-ios')).toBe(false);
      expect(await gameStateStore.isDeviceActive('u1', webDevice)).toBe(true);
    });

    it('suppresses the iOS token when that phone is active and leaves the web device active', async () => {
      const pushNotifier = new CapturingPushNotifier();
      const userDirectory = new InMemoryUserDirectory();
      const gameStateStore = new InMemoryGameStateStore();
      const iosDevice = '33333333-3333-4333-8333-333333333333';
      const webDevice = '22222222-2222-4222-8222-222222222222';
      userDirectory.setViewingSession('u1', { primaryGameId: 'g1', primaryPriorityScore: 5 });
      await gameStateStore.markConnectionActive(
        {
          userId: 'u1',
          deviceId: iosDevice,
          connectionId: 'phone',
          platform: 'ios',
          visibility: 'visible',
        },
        60_000,
      );
      await gameStateStore.markConnectionActive(
        {
          userId: 'u1',
          deviceId: webDevice,
          connectionId: 'web',
          platform: 'web',
          visibility: 'visible',
        },
        60_000,
      );
      const deps = buildDeps({ pushNotifier, userDirectory, gameStateStore });

      await deliverFlagEvent(deps, makeEvent(), { ...pushUser, expoPushDeviceId: iosDevice });

      expect(pushNotifier.calls).toHaveLength(0);
      expect(await gameStateStore.isDeviceActive('u1', webDevice)).toBe(true);
    });

    it('suppresses the push once a new build registers the device that is foregrounded', async () => {
      const pushNotifier = new CapturingPushNotifier();
      const userDirectory = new InMemoryUserDirectory();
      const gameStateStore = new InMemoryGameStateStore();
      const iosDevice = '33333333-3333-4333-8333-333333333333';
      userDirectory.setViewingSession('u1', { primaryGameId: 'g1', primaryPriorityScore: 5 });
      await gameStateStore.markConnectionActive(
        {
          userId: 'u1',
          deviceId: iosDevice,
          connectionId: 'phone',
          platform: 'ios',
          visibility: 'visible',
        },
        60_000,
      );
      const deps = buildDeps({ pushNotifier, userDirectory, gameStateStore });

      await deliverFlagEvent(deps, makeEvent(), pushUser);
      expect(pushNotifier.calls).toHaveLength(1);

      await deliverFlagEvent(deps, makeEvent({ id: 'evt-2' }), {
        ...pushUser,
        expoPushDeviceId: iosDevice,
      });
      expect(pushNotifier.calls).toHaveLength(1);
    });

    it('does not count a hidden web tab as active', async () => {
      const gameStateStore = new InMemoryGameStateStore();
      const webDevice = '22222222-2222-4222-8222-222222222222';
      await gameStateStore.markConnectionActive(
        {
          userId: 'u1',
          deviceId: webDevice,
          connectionId: 'web',
          platform: 'web',
          visibility: 'hidden',
        },
        60_000,
      );

      expect(await gameStateStore.isDeviceActive('u1', webDevice)).toBe(false);
      expect(await gameStateStore.isUserActive('u1')).toBe(false);
    });

    it('sends a push when the phone is off even if this game is still the stored primary', async () => {
      const pushNotifier = new CapturingPushNotifier();
      const userDirectory = new InMemoryUserDirectory();
      const gameStateStore = new InMemoryGameStateStore();
      const bus = new InMemoryRealtimeBus();
      const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      userDirectory.setViewingSession('u1', { primaryGameId: 'g1', primaryPriorityScore: 5 });
      const deps = buildDeps({
        pushNotifier,
        userDirectory,
        gameStateStore,
        realtimeBus: bus,
      });

      await deliverFlagEvent(deps, makeEvent(), pushUser);

      expect(await gameStateStore.isUserActive('u1')).toBe(false);
      expect(pushNotifier.calls).toHaveLength(1);
      const envelope = bus.published[0]?.message as FlagEventEnvelope;
      expect(envelope.payload.action.type).toBe('prompt');
      expect(logs.mock.calls.map((call) => call[0])).toContain(
        '[dispatcher] push decision user=u1 game=g1 flag=evt-1 result=sent anchor_play=- play_wallclock=- seen_at=- enqueued_at=- sent_at=2023-11-14T22:14:21.500Z post_lag_ms=- send_lag_ms=-',
      );
      logs.mockRestore();
    });

    it('push failure does not prevent persistence or the realtime publish (order independence)', async () => {
      const pushNotifier = new CapturingPushNotifier();
      pushNotifier.nextResult = { success: false, error: 'DeviceNotRegistered' };
      const persistence = new InMemoryFlagEventPersistence();
      const bus = new InMemoryRealtimeBus();
      const deps = buildDeps({ pushNotifier, persistence, realtimeBus: bus });

      await expect(deliverFlagEvent(deps, makeEvent(), pushUser)).resolves.toBe('inserted');

      expect(persistence.records).toHaveLength(1);
      expect(bus.published).toHaveLength(1);
    });

    it('retries a failed push once the row exists and delivers exactly one', async () => {
      const pushNotifier = new CapturingPushNotifier();
      let delivered = 0;
      pushNotifier.sendPush = async (payload) => {
        pushNotifier.calls.push(payload);
        if (pushNotifier.calls.length === 1) return { success: false, error: 'network down' };
        delivered += 1;
        return { success: true };
      };
      const persistence = new InMemoryFlagEventPersistence();
      const gameStateStore = new InMemoryGameStateStore();
      await setPossessingHomeGameState(gameStateStore);
      const deps = buildDeps({
        pushNotifier,
        persistence,
        gameStateStore,
        gameCatalog: gameCatalogWithNames(),
      });
      const deliveredAt = 1_700_000_061_500;

      await deliverFlagEvent(deps, makeEvent(), pushUser);

      const rowId = persistence.records[0]?.id;
      expect(persistence.records).toHaveLength(1);
      expect(rowId).toBeDefined();
      expect(persistence.pushOutcome(rowId ?? '')?.status).toBe('pending');
      expect(pushNotifier.calls).toHaveLength(1);

      await retryPendingPushes(deps, deliveredAt + PUSH_RETRY_BACKOFF_MS);

      expect(pushNotifier.calls).toHaveLength(2);
      expect(delivered).toBe(1);
      expect(persistence.records).toHaveLength(1);
      expect(persistence.pushOutcome(rowId ?? '')?.status).toBe('sent');
    });

    it('drops a failed push once the reveal is two minutes old', async () => {
      const pushNotifier = new CapturingPushNotifier();
      pushNotifier.nextResult = { success: false, error: 'network down' };
      const persistence = new InMemoryFlagEventPersistence();
      const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const deps = buildDeps({ pushNotifier, persistence });
      const deliveredAt = 1_700_000_061_500;

      await deliverFlagEvent(deps, makeEvent(), pushUser);
      const rowId = persistence.records[0]?.id ?? '';

      await retryPendingPushes(deps, deliveredAt + PUSH_RELEVANCE_MS);

      expect(pushNotifier.calls).toHaveLength(1);
      expect(persistence.pushOutcome(rowId)?.status).toBe('dropped');
      expect(logs.mock.calls.map((call) => call[0])).toContain(
        `[push] retry dropped u1 ${rowId}: reveal older than 2m`,
      );
      logs.mockRestore();
    });

    it('a thrown push rejection is caught and does not propagate out of deliverFlagEvent', async () => {
      const throwingPushNotifier = new CapturingPushNotifier();
      throwingPushNotifier.sendPush = async () => {
        throw new Error('network down');
      };
      const persistence = new InMemoryFlagEventPersistence();
      const bus = new InMemoryRealtimeBus();
      const deps = buildDeps({ pushNotifier: throwingPushNotifier, persistence, realtimeBus: bus });

      await expect(deliverFlagEvent(deps, makeEvent(), pushUser)).resolves.toBe('inserted');

      expect(persistence.records).toHaveLength(1);
      expect(bus.published).toHaveLength(1);
    });

    it('push payload title/body match what notificationContent produces for the same inputs', async () => {
      const pushNotifier = new CapturingPushNotifier();
      const gameStateStore = new InMemoryGameStateStore();
      await setPossessingHomeGameState(gameStateStore);
      const playerCatalog = new InMemoryPlayerCatalog();
      playerCatalog.setPlayer({
        playerId: 'p1',
        firstName: 'Jonathan',
        lastName: 'Taylor',
        position: 'RB',
      });
      const deps = buildDeps({
        pushNotifier,
        gameStateStore,
        gameCatalog: gameCatalogWithNames(),
        playerCatalog,
      });
      const event = makeEvent({
        newState: makeFlagState({
          reasons: [{ type: 'offense_active', triggeringPlayerIds: ['p1'] }],
        }),
      });

      await deliverFlagEvent(deps, event, pushUser);

      const game = {
        possessionTeamName: 'Colts',
        defenseTeamName: 'Broncos',
        quarter: 2,
        timeRemainingSec: 434,
        yardsToOpponentEndzone: null,
        down: null,
        distance: null,
      };
      expect(pushNotifier.calls[0]?.title).toBe(
        notificationTitle(event, game, [
          { playerId: 'p1', firstName: 'Jonathan', lastName: 'Taylor', position: 'RB' },
        ]),
      );
      expect(pushNotifier.calls[0]?.body).toBe(notificationBody(event, game));
      expect(pushNotifier.calls[0]?.title).toBe('Jonathan Taylor active');
      expect(pushNotifier.calls[0]?.body).toBe('Colts have the ball — Q2, 7:14. Tap to watch.');
    });

    it('still pushes with no option, naming the airing instead of "Tap to watch"', async () => {
      const pushNotifier = new CapturingPushNotifier();
      const gameStateStore = new InMemoryGameStateStore();
      await setPossessingHomeGameState(gameStateStore);
      const deps = buildDeps({
        pushNotifier,
        gameStateStore,
        gameCatalog: gameCatalogWithNames(),
        broadcastCatalog: weekCatalog([]),
      });

      await deliverFlagEvent(deps, makeEvent(), pushUser);

      expect(pushNotifier.calls).toHaveLength(1);
      expect(pushNotifier.calls[0]?.body).toBe('Colts have the ball — Q2, 7:14. On FOX.');
      const data = pushNotifier.calls[0]?.data as FlagEventEnvelope['payload'];
      expect(data.action.deep_link_url).toBeNull();
      expect(data.action.recommended_source).toBeNull();
    });

    it('push data carries the identical envelope payload published over the realtime bus', async () => {
      const pushNotifier = new CapturingPushNotifier();
      const bus = new InMemoryRealtimeBus();
      const deps = buildDeps({ pushNotifier, realtimeBus: bus });

      await deliverFlagEvent(deps, makeEvent(), pushUser);

      const envelope = bus.published[0]?.message as FlagEventEnvelope;
      expect(pushNotifier.calls[0]?.data).toBe(envelope.payload);
    });
  });
});

const IOS_DEVICE = '33333333-3333-4333-8333-333333333333';
const WEB_DEVICE = '22222222-2222-4222-8222-222222222222';
const EXPO_TOKEN = 'ExponentPushToken[test-token-000000000]';

function comparablePush(call: PushPayload | undefined): unknown {
  const data = { ...(call?.data as Record<string, unknown>) };
  delete data['event_id'];
  return { token: call?.token, title: call?.title, body: call?.body, data };
}

describe('web push beside Expo', () => {
  const legacyUser: DispatchUser = { ...freeUser, expoPushToken: EXPO_TOKEN };
  const namedUser: DispatchUser = { ...legacyUser, expoPushDeviceId: IOS_DEVICE };

  async function deliver(user: DispatchUser, withWeb: boolean) {
    const pushNotifier = new CapturingPushNotifier();
    const web = new CapturingWebPushSender();
    const subscriptions = new InMemoryWebPushSubscriptionStore(
      withWeb
        ? [
            {
              userId: 'u1',
              endpoint: 'https://push.example.test/1',
              deviceId: WEB_DEVICE,
              p256dh: 'p256',
              auth: 'authkey',
            },
            {
              userId: 'u1',
              endpoint: 'https://push.example.test/2',
              deviceId: '44444444-4444-4444-8444-444444444444',
              p256dh: 'p256',
              auth: 'authkey',
            },
          ]
        : [],
    );
    const rateLimitStore = new InMemoryRateLimitStore();
    const deps = buildDeps({
      pushNotifier,
      rateLimitStore,
      ...(withWeb ? { webPush: { sender: web, subscriptions } } : {}),
    });
    await deliverFlagEvent(deps, makeEvent(), user);
    return { pushNotifier, web, subscriptions, rateLimitStore };
  }

  it('keeps the Expo payload the same for a legacy device and a named device', async () => {
    for (const user of [legacyUser, namedUser]) {
      const plain = await deliver(user, false);
      const fanned = await deliver(user, true);
      expect(plain.pushNotifier.calls).toHaveLength(1);
      expect(fanned.pushNotifier.calls).toHaveLength(1);
      expect(comparablePush(fanned.pushNotifier.calls[0])).toEqual(
        comparablePush(plain.pushNotifier.calls[0]),
      );
      expect(fanned.web.calls).toHaveLength(2);
      expect(fanned.web.calls[0]?.title).toBe(plain.pushNotifier.calls[0]?.title);
      expect(fanned.web.calls[0]?.body).toBe(plain.pushNotifier.calls[0]?.body);
      expect(fanned.web.calls[0]?.ttlSeconds).toBe(WEB_PUSH_TTL_SECONDS);
      expect(fanned.web.calls[0]?.urgency).toBe('high');
      expect(fanned.web.calls[0]?.collapseKey).toBe(webPushCollapseKey('u1'));
      expect(fanned.web.calls[0]?.collapseKey).toBe(fanned.web.calls[1]?.collapseKey);
      expect(fanned.rateLimitStore.entriesFor('u1')).toHaveLength(1);
    }
  });

  it('skips only the web device that is visible on the primary, and still pushes to the phone', async () => {
    const pushNotifier = new CapturingPushNotifier();
    const web = new CapturingWebPushSender();
    const subscriptions = new InMemoryWebPushSubscriptionStore([
      {
        userId: 'u1',
        endpoint: 'https://push.example.test/1',
        deviceId: WEB_DEVICE,
        p256dh: 'p256',
        auth: 'authkey',
      },
    ]);
    const users = new InMemoryUserDirectory();
    users.setViewingSession('u1', { primaryGameId: 'g1', primaryPriorityScore: 4 });
    const gameStateStore = new InMemoryGameStateStore();
    await gameStateStore.markConnectionActive(
      {
        userId: 'u1',
        deviceId: WEB_DEVICE,
        connectionId: 'web',
        platform: 'web',
        visibility: 'visible',
      },
      60_000,
    );
    const deps = buildDeps({
      pushNotifier,
      userDirectory: users,
      gameStateStore,
      webPush: { sender: web, subscriptions },
    });
    const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await deliverFlagEvent(deps, makeEvent(), namedUser);

    expect(pushNotifier.calls).toHaveLength(1);
    expect(web.calls).toHaveLength(0);
    const lines = logs.mock.calls.map((call) => String(call[0]));
    expect(lines).toContain(`[push] ios device=${IOS_DEVICE} result=sent`);
    expect(lines).toContain(`[web-push] device=${WEB_DEVICE} result=skipped_visible_primary`);
    logs.mockRestore();
  });

  it('sends the web push when that tab is hidden, and still pushes to a backgrounded phone', async () => {
    const pushNotifier = new CapturingPushNotifier();
    const web = new CapturingWebPushSender();
    const subscriptions = new InMemoryWebPushSubscriptionStore([
      {
        userId: 'u1',
        endpoint: 'https://push.example.test/1',
        deviceId: WEB_DEVICE,
        p256dh: 'p256',
        auth: 'authkey',
      },
    ]);
    const users = new InMemoryUserDirectory();
    users.setViewingSession('u1', { primaryGameId: 'g1', primaryPriorityScore: 4 });
    const gameStateStore = new InMemoryGameStateStore();
    await gameStateStore.markConnectionActive(
      {
        userId: 'u1',
        deviceId: WEB_DEVICE,
        connectionId: 'web',
        platform: 'web',
        visibility: 'hidden',
      },
      60_000,
    );
    const deps = buildDeps({
      pushNotifier,
      userDirectory: users,
      gameStateStore,
      webPush: { sender: web, subscriptions },
    });

    await deliverFlagEvent(deps, makeEvent(), legacyUser);

    expect(pushNotifier.calls).toHaveLength(1);
    expect(web.calls).toHaveLength(1);
  });

  it('does not push to the phone when the legacy device is on the primary, and still pushes to the laptop', async () => {
    const pushNotifier = new CapturingPushNotifier();
    const web = new CapturingWebPushSender();
    const subscriptions = new InMemoryWebPushSubscriptionStore([
      {
        userId: 'u1',
        endpoint: 'https://push.example.test/1',
        deviceId: WEB_DEVICE,
        p256dh: 'p256',
        auth: 'authkey',
      },
    ]);
    const users = new InMemoryUserDirectory();
    users.setViewingSession('u1', { primaryGameId: 'g1', primaryPriorityScore: 4 });
    const gameStateStore = new InMemoryGameStateStore();
    await gameStateStore.markUserActive('u1', 60_000);
    const deps = buildDeps({
      pushNotifier,
      userDirectory: users,
      gameStateStore,
      webPush: { sender: web, subscriptions },
    });

    await deliverFlagEvent(deps, makeEvent(), legacyUser);

    expect(pushNotifier.calls).toHaveLength(0);
    expect(web.calls).toHaveLength(1);
  });

  it('deletes a subscription the push service reports as gone', async () => {
    const pushNotifier = new CapturingPushNotifier();
    const web = new CapturingWebPushSender();
    web.nextResult = { ok: false, statusCode: 410 };
    const subscriptions = new InMemoryWebPushSubscriptionStore([
      {
        userId: 'u1',
        endpoint: 'https://push.example.test/1',
        deviceId: WEB_DEVICE,
        p256dh: 'p256',
        auth: 'authkey',
      },
    ]);
    const deps = buildDeps({
      pushNotifier,
      webPush: { sender: web, subscriptions },
    });

    await deliverFlagEvent(deps, makeEvent(), legacyUser);

    expect(pushNotifier.calls).toHaveLength(1);
    expect(subscriptions.rows.has('https://push.example.test/1')).toBe(false);
  });

  it('records last success without a second rate-limit hit', async () => {
    const rateLimitStore = new InMemoryRateLimitStore();
    const web = new CapturingWebPushSender();
    const subscriptions = new InMemoryWebPushSubscriptionStore([
      {
        userId: 'u1',
        endpoint: 'https://push.example.test/1',
        deviceId: WEB_DEVICE,
        p256dh: 'p256',
        auth: 'authkey',
      },
    ]);
    const deps = buildDeps({
      rateLimitStore,
      webPush: { sender: web, subscriptions },
    });

    await deliverFlagEvent(deps, makeEvent(), legacyUser);

    expect(rateLimitStore.entriesFor('u1')).toHaveLength(1);
    expect(subscriptions.rows.get('https://push.example.test/1')?.lastSuccessAt).toBe(
      1_700_000_061_500,
    );
  });

  function oneWebSub(): InMemoryWebPushSubscriptionStore {
    return new InMemoryWebPushSubscriptionStore([
      {
        userId: 'u1',
        endpoint: 'https://push.example.test/1',
        deviceId: WEB_DEVICE,
        p256dh: 'p256',
        auth: 'authkey',
      },
    ]);
  }

  it('still sends the web push when Expo throws', async () => {
    const pushNotifier = new CapturingPushNotifier();
    pushNotifier.sendPush = async () => {
      throw new Error('network down');
    };
    const web = new CapturingWebPushSender();
    const persistence = new InMemoryFlagEventPersistence();
    const deps = buildDeps({
      pushNotifier,
      persistence,
      webPush: { sender: web, subscriptions: oneWebSub() },
    });

    await expect(deliverFlagEvent(deps, makeEvent(), legacyUser)).resolves.toBe('inserted');

    expect(web.calls).toHaveLength(1);
    expect(web.calls[0]?.title).toBeTruthy();
    const rowId = persistence.records[0]?.id ?? '';
    expect(persistence.pushOutcome(rowId)?.status).toBe('pending');
    expect(persistence.pushOutcome(rowId)?.lastError).toBe('network down');
  });

  it('sends the web push while the Expo send is still pending', async () => {
    let release = (): void => {
      // Replaced by the gate promise's resolver below.
    };
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pushNotifier = new CapturingPushNotifier();
    pushNotifier.sendPush = async (payload) => {
      pushNotifier.calls.push(payload);
      await gate;
      return { success: true };
    };
    const web = new CapturingWebPushSender();
    const deps = buildDeps({
      pushNotifier,
      webPush: { sender: web, subscriptions: oneWebSub() },
    });

    const pending = deliverFlagEvent(deps, makeEvent(), namedUser);
    await vi.waitFor(() => expect(web.calls).toHaveLength(1));
    expect(pushNotifier.calls).toHaveLength(1);
    expect(web.calls[0]?.data).toEqual(pushNotifier.calls[0]?.data);
    release();
    await pending;
  });

  it('leaves the Expo payload and decision log unchanged when web fan-out throws', async () => {
    async function expoSide(webThrows: boolean) {
      const pushNotifier = new CapturingPushNotifier();
      const persistence = new InMemoryFlagEventPersistence();
      const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const subscriptions = oneWebSub();
      if (webThrows) {
        subscriptions.listForUser = async () => {
          throw new Error('web down');
        };
      }
      const deps = buildDeps({
        pushNotifier,
        persistence,
        ...(webThrows ? { webPush: { sender: new CapturingWebPushSender(), subscriptions } } : {}),
      });
      await deliverFlagEvent(deps, makeEvent(), legacyUser);
      const decisionLogs = logs.mock.calls.map((call) => String(call[0]));
      const expoErrors = errors.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.startsWith('[push]'));
      logs.mockRestore();
      errors.mockRestore();
      const rowId = persistence.records[0]?.id ?? '';
      return {
        push: comparablePush(pushNotifier.calls[0]),
        status: persistence.pushOutcome(rowId)?.status,
        decisionLogs,
        expoErrors,
      };
    }

    const plain = await expoSide(false);
    const thrown = await expoSide(true);
    expect(thrown.push).toEqual(plain.push);
    expect(thrown.status).toBe(plain.status);
    expect(thrown.decisionLogs).toEqual(plain.decisionLogs);
    expect(thrown.expoErrors).toEqual(plain.expoErrors);
  });

  it('leaves the Expo result unchanged when one web send throws', async () => {
    const pushNotifier = new CapturingPushNotifier();
    const web = new CapturingWebPushSender();
    web.send = async () => {
      throw new Error('push service down');
    };
    const persistence = new InMemoryFlagEventPersistence();
    const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const deps = buildDeps({
      pushNotifier,
      persistence,
      webPush: { sender: web, subscriptions: oneWebSub() },
    });

    await expect(deliverFlagEvent(deps, makeEvent(), namedUser)).resolves.toBe('inserted');

    const rowId = persistence.records[0]?.id ?? '';
    expect(persistence.pushOutcome(rowId)?.status).toBe('sent');
    expect(comparablePush(pushNotifier.calls[0])).toMatchObject({ token: EXPO_TOKEN });
    expect(logs.mock.calls.map((call) => String(call[0]))).toContain(
      '[dispatcher] push decision user=u1 game=g1 flag=evt-1 result=sent anchor_play=- play_wallclock=- seen_at=- enqueued_at=- sent_at=2023-11-14T22:14:21.500Z post_lag_ms=- send_lag_ms=-',
    );
    logs.mockRestore();
  });
});

/** iOS `data` from a delivery with no web push, recorded before `saved_url` existed. */
const FLAG_ADDED_IOS_PAYLOAD = {
  event_id: '<uuid>',
  user_id: 'u1',
  game_id: 'g1',
  event_type: 'flag_added',
  old_state: null,
  new_state: {
    gameId: 'g1',
    flagged: true,
    priorityScore: 10,
    reasons: [{ type: 'offense_active', triggeringPlayerIds: ['p1', 'p2'] }],
    computedAt: 1700000000000,
    possession_team: null,
  },
  action: {
    type: 'prompt',
    cta: 'switch_primary',
    recommended_source: null,
    deep_link_url: null,
  },
  game_summary: {
    home_team: '',
    away_team: '',
    home_team_name: '',
    away_team_name: '',
    home_team_primary_color: '',
    home_team_secondary_color: '',
    away_team_primary_color: '',
    away_team_secondary_color: '',
    score: { home: 0, away: 0 },
    quarter: 0,
    time_remaining_sec: 0,
    possession_team: null,
    yards_to_endzone: null,
    down: null,
    distance: null,
    in_red_zone: false,
  },
  flagged_players: [],
};

const BET_IN_PLAY_IOS_PAYLOAD = {
  ...FLAG_ADDED_IOS_PAYLOAD,
  event_type: 'bet_in_play',
  new_state: {
    gameId: 'g1',
    flagged: false,
    priorityScore: 1,
    reasons: [],
    computedAt: 1700000000000,
    possession_team: null,
  },
};

const SAVED = 'https://www.primevideo.com/detail/test';

function iosPayload(call: PushPayload | undefined): unknown {
  const copy = structuredClone(call?.data) as { event_id?: string };
  copy.event_id = '<uuid>';
  return copy;
}

function webAction(data: unknown): Record<string, unknown> {
  return (data as { action: Record<string, unknown> }).action;
}

describe('web push saved_url', () => {
  const iosUser: DispatchUser = { ...freeUser, expoPushToken: EXPO_TOKEN };

  function twoBrowsers(): InMemoryWebPushSubscriptionStore {
    return new InMemoryWebPushSubscriptionStore([
      {
        userId: 'u1',
        endpoint: 'https://push.example.test/1',
        deviceId: WEB_DEVICE,
        p256dh: 'p256',
        auth: 'authkey',
      },
      {
        userId: 'u1',
        endpoint: 'https://push.example.test/2',
        deviceId: '44444444-4444-4444-8444-444444444444',
        p256dh: 'p256',
        auth: 'authkey',
      },
    ]);
  }

  async function deliver(
    event: FlagEvent,
    savedLinks?: { urlFor: (userId: string, gameId: string) => Promise<string | null> },
  ) {
    const pushNotifier = new CapturingPushNotifier();
    const web = new CapturingWebPushSender();
    const bus = new InMemoryRealtimeBus();
    const deps = buildDeps({
      pushNotifier,
      realtimeBus: bus,
      webPush: { sender: web, subscriptions: twoBrowsers(), ...(savedLinks ? { savedLinks } : {}) },
    });
    await deliverFlagEvent(deps, event, iosUser);
    return { pushNotifier, web, bus };
  }

  it('puts the saved url on every web payload and leaves the Expo payload unchanged', async () => {
    const calls: string[] = [];
    const sent = await deliver(makeEvent(), {
      urlFor: async (userId, gameId) => {
        calls.push(`${userId}:${gameId}`);
        return SAVED;
      },
    });

    expect(calls).toEqual(['u1:g1']);
    expect(sent.web.calls).toHaveLength(2);
    expect(webAction(sent.web.calls[0]?.data).saved_url).toBe(SAVED);
    expect(webAction(sent.web.calls[1]?.data).saved_url).toBe(SAVED);
    expect(iosPayload(sent.pushNotifier.calls[0])).toEqual(FLAG_ADDED_IOS_PAYLOAD);
    expect(sent.pushNotifier.calls[0]?.data).not.toHaveProperty('action.saved_url');
    expect((sent.pushNotifier.calls[0]?.data as { action: object }).action).not.toHaveProperty(
      'saved_url',
    );
    const envelope = sent.bus.published[0]?.message as FlagEventEnvelope;
    expect(envelope.payload.action).not.toHaveProperty('saved_url');
  });

  it('omits saved_url when the user has no link for the game', async () => {
    const sent = await deliver(makeEvent(), { urlFor: async () => null });
    expect(sent.web.calls).toHaveLength(2);
    expect(webAction(sent.web.calls[0]?.data)).not.toHaveProperty('saved_url');
    expect(sent.web.calls[0]?.data).toEqual(sent.pushNotifier.calls[0]?.data);
  });

  it('omits saved_url and still sends when the lookup throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sent = await deliver(makeEvent(), {
      urlFor: async () => {
        throw new Error('db down');
      },
    });
    expect(sent.web.calls).toHaveLength(2);
    expect(sent.pushNotifier.calls).toHaveLength(1);
    expect(webAction(sent.web.calls[0]?.data)).not.toHaveProperty('saved_url');
    expect(iosPayload(sent.pushNotifier.calls[0])).toEqual(FLAG_ADDED_IOS_PAYLOAD);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('keeps the bet_in_play Expo payload identical to the pre-change builder output', async () => {
    const plain = buildDeps({ pushNotifier: new CapturingPushNotifier() });
    const event = makeEvent({
      type: 'bet_in_play',
      label: 'spread',
      code: 'ONE_SCORE_LATE',
      stakeId: 'stake-1',
      newState: makeFlagState({ flagged: false, reasons: [], priorityScore: 1 }),
    });
    await deliverFlagEvent(plain, event, iosUser);

    const withLink = await deliver(event, { urlFor: async () => SAVED });

    expect(iosPayload((plain.pushNotifier as CapturingPushNotifier).calls[0])).toEqual(
      BET_IN_PLAY_IOS_PAYLOAD,
    );
    expect(iosPayload(withLink.pushNotifier.calls[0])).toEqual(BET_IN_PLAY_IOS_PAYLOAD);
    expect(webAction(withLink.web.calls[0]?.data).saved_url).toBe(SAVED);
  });
});
