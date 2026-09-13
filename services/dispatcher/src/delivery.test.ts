import { describe, expect, it } from 'vitest';
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
import { notificationBody, notificationTitle } from './notificationContent.js';
import { CapturingPushNotifier } from './pushNotifier.js';
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
    expect(envelope.payload.event_id).toBe('evt-1');
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

  it('recommends the SAME source used for timing, even when a lower-lag free broadcast exists (Phase 3b)', async () => {
    // User is subscribed to espn_plus (lag 60). The game also airs on free fox (lag 8), which
    // rankBroadcasts would prefer — but resolveLikelyBroadcastSource times the fire against espn_plus
    // (fox isn't in the user's presence), so the CTA must point at espn_plus for consistency.
    const broadcastCatalog = new InMemoryBroadcastCatalog();
    broadcastCatalog.setGameBroadcasts('g1', [
      { service: 'espn_plus', deepLinkUrl: 'https://espn.example/g1', requiresSubscription: true },
      { service: 'fox', deepLinkUrl: 'https://fox.example/g1', requiresSubscription: false },
    ]);
    broadcastCatalog.setUserSubscribedServices('u1', ['espn_plus']);
    const bus = new InMemoryRealtimeBus();
    const deps = buildDeps({ broadcastCatalog, realtimeBus: bus });

    await deliverFlagEvent(deps, makeEvent(), freeUser);

    const envelope = bus.published[0]?.message as FlagEventEnvelope;
    expect(envelope.payload.action.recommended_source).toBe('espn_plus');
    expect(envelope.payload.action.deep_link_url).toBe('https://espn.example/g1');
  });

  it('falls back to the ranker preferred broadcast when there is no timing source (Phase 3b)', async () => {
    // User has zero subscribed services -> resolveLikelyBroadcastSource returns null -> fall back to
    // BroadcastResolver's preferred, which is the free broadcast the user can still watch.
    const broadcastCatalog = new InMemoryBroadcastCatalog();
    broadcastCatalog.setGameBroadcasts('g1', [
      { service: 'nbc', deepLinkUrl: 'https://nbc.example/g1', requiresSubscription: false },
    ]);
    // No setUserSubscribedServices -> empty set.
    const bus = new InMemoryRealtimeBus();
    const deps = buildDeps({ broadcastCatalog, realtimeBus: bus });

    await deliverFlagEvent(deps, makeEvent(), freeUser);

    const envelope = bus.published[0]?.message as FlagEventEnvelope;
    expect(envelope.payload.action.recommended_source).toBe('nbc');
    expect(envelope.payload.action.deep_link_url).toBe('https://nbc.example/g1');
  });

  it('degrades to null when the only broadcast is ineligible and there is no timing source (Phase 3b)', async () => {
    const broadcastCatalog = new InMemoryBroadcastCatalog();
    broadcastCatalog.setGameBroadcasts('g1', [
      { service: 'sunday_ticket', deepLinkUrl: 'https://st.example/g1', requiresSubscription: true },
    ]);
    // User isn't subscribed -> not a timing source AND not eligible for the ranker.
    const bus = new InMemoryRealtimeBus();
    const deps = buildDeps({ broadcastCatalog, realtimeBus: bus });

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

    it('does NOT send push when the user has no expo_push_token', async () => {
      const pushNotifier = new CapturingPushNotifier();
      const deps = buildDeps({ pushNotifier });

      await deliverFlagEvent(deps, makeEvent(), freeUser); // freeUser.expoPushToken is null

      expect(pushNotifier.calls).toHaveLength(0);
    });

    it('does NOT send push when action.type is in_app_indicator (already-primary game)', async () => {
      const pushNotifier = new CapturingPushNotifier();
      const userDirectory = new InMemoryUserDirectory();
      // Session's primary game IS this event's game -> decideAction returns in_app_indicator.
      userDirectory.setViewingSession('u1', { primaryGameId: 'g1', primaryPriorityScore: 5 });
      const deps = buildDeps({ pushNotifier, userDirectory });

      await deliverFlagEvent(deps, makeEvent(), pushUser);

      expect(pushNotifier.calls).toHaveLength(0);
    });

    it('push failure does not prevent persistence or the realtime publish (order independence)', async () => {
      const pushNotifier = new CapturingPushNotifier();
      pushNotifier.nextResult = { success: false, error: 'DeviceNotRegistered' };
      const persistence = new InMemoryFlagEventPersistence();
      const bus = new InMemoryRealtimeBus();
      const deps = buildDeps({ pushNotifier, persistence, realtimeBus: bus });

      await expect(deliverFlagEvent(deps, makeEvent(), pushUser)).resolves.toBeUndefined();

      expect(persistence.records).toHaveLength(1);
      expect(bus.published).toHaveLength(1);
    });

    it('a thrown push rejection is caught and does not propagate out of deliverFlagEvent', async () => {
      const throwingPushNotifier = new CapturingPushNotifier();
      throwingPushNotifier.sendPush = async () => {
        throw new Error('network down');
      };
      const persistence = new InMemoryFlagEventPersistence();
      const bus = new InMemoryRealtimeBus();
      const deps = buildDeps({ pushNotifier: throwingPushNotifier, persistence, realtimeBus: bus });

      await expect(deliverFlagEvent(deps, makeEvent(), pushUser)).resolves.toBeUndefined();

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
