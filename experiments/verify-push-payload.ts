/**
 * THROWAWAY TEST HARNESS CODE — not part of the Pivot app, not production code.
 *
 * Pre-flight check: does the push `data` that `deliverFlagEvent` actually produces satisfy the app's
 * `isFlagEventPayload` guard?
 *
 * Worth its own check because the failure is silent and expensive. `NotificationBannerHost` and
 * `notificationResponse.ts` both drop a notification whose `data` fails that guard, so a mismatch
 * shows up as a push that arrives and then does nothing when tapped — indistinguishable, mid-game,
 * from a dispatcher or resumption bug. And nothing in the suite covers it: `isFlagEventPayload` is a
 * hand-copied mirror of `FlagEventEnvelope['payload']` living in `app/`, tested only against
 * hand-written fixtures, never against a payload the dispatcher really emitted.
 *
 * Usage:
 *   npx tsx experiments/verify-push-payload.ts
 */

import {
  CapturingPushNotifier,
  InMemoryBroadcastCatalog,
  InMemoryFlagEventPersistence,
  InMemoryGameCatalog,
  InMemoryGameStateStore,
  InMemoryPlayerCatalog,
  InMemoryRateLimitStore,
  InMemoryRealtimeBus,
  InMemoryUserDirectory,
  deliverFlagEvent,
  type DeliveryDeps,
  type DispatchUser,
} from '@pivot/dispatcher';
import type { FlagEvent, GameState } from '@pivot/shared';

import { teamInfo } from './nflTeams.js';

/**
 * The guard is loaded at RUNTIME, through a non-literal specifier, on purpose.
 *
 * A static `import` from `app/` pulls that file into this directory's TypeScript program, where it is
 * compiled under `experiments/tsconfig.json` instead of the app's own config — which both violates
 * `rootDir` and reports `noPropertyAccessFromIndexSignature` errors inside a file that is perfectly
 * valid where it lives. Resolving it dynamically keeps the REAL guard under test (the point of this
 * script) without dragging app source into the wrong compiler settings.
 */
const GUARD_MODULE = '../app/lib/flagEventPayload.js';

/** The fields this script checks beyond the guard, declared locally for the same reason as above. */
interface CheckedPayload {
  action: { deep_link_url: string | null };
  game_summary: { possession_team: string | null; home_team_primary_color: string };
  flagged_players: unknown[];
}

const USER_ID = 'verify-user';
const GAME_ID = '401872656';
const HOME = 'SEA';
const AWAY = 'NE';

async function main(): Promise<void> {
  const gameStateStore = new InMemoryGameStateStore();
  const gameCatalog = new InMemoryGameCatalog();
  const playerCatalog = new InMemoryPlayerCatalog();
  const broadcastCatalog = new InMemoryBroadcastCatalog();
  const userDirectory = new InMemoryUserDirectory();
  const pushNotifier = new CapturingPushNotifier();

  const gameState: GameState = {
    gameId: GAME_ID,
    homeTeamId: HOME,
    awayTeamId: AWAY,
    possessionTeamId: HOME,
    unitOnField: 'offense',
    scoreHome: 7,
    scoreAway: 3,
    quarter: 2,
    timeRemainingSec: 434,
    yardsToOpponentEndzone: 18,
    down: 1,
    distance: 10,
    inRedZone: true,
    status: 'in_progress',
    updatedAt: Date.now(),
  };
  await gameStateStore.setGameState(GAME_ID, gameState);

  const home = teamInfo(HOME);
  const away = teamInfo(AWAY);
  gameCatalog.setGame(GAME_ID, {
    homeTeamAbbreviation: HOME,
    awayTeamAbbreviation: AWAY,
    homeTeamName: home.nickname,
    awayTeamName: away.nickname,
    homeTeamPrimaryColor: home.primaryColor,
    homeTeamSecondaryColor: home.secondaryColor,
    awayTeamPrimaryColor: away.primaryColor,
    awayTeamSecondaryColor: away.secondaryColor,
  });

  playerCatalog.setPlayer({
    playerId: `${HOME}-RB1`,
    firstName: home.nickname,
    lastName: 'RB1',
    position: 'RB',
  });

  broadcastCatalog.setGameBroadcasts(GAME_ID, [
    { service: 'sunday_ticket', deepLinkUrl: 'https://tv.youtube.com/live', requiresSubscription: true },
  ]);
  broadcastCatalog.setUserSubscribedServices(USER_ID, ['sunday_ticket']);

  const user: DispatchUser = {
    id: USER_ID,
    subscriptionTier: 'pro',
    preferences: {
      notificationMode: 'all',
      quietHours: { enabled: false, startHour: 22, endHour: 8, timezone: 'America/New_York' },
      autoSwitch: false,
    },
    expoPushToken: 'ExponentPushToken[verify]',
  };
  userDirectory.setUser(user);

  const now = Date.now();
  const event: FlagEvent = {
    id: 'verify-event-1',
    userId: USER_ID,
    gameId: GAME_ID,
    type: 'flag_added',
    oldState: null,
    newState: {
      gameId: GAME_ID,
      flagged: true,
      priorityScore: 10,
      reasons: [
        { type: 'offense_active', triggeringPlayerIds: [`${HOME}-RB1`] },
        { type: 'red_zone', triggeringPlayerIds: [] },
      ],
      computedAt: now,
    },
    scheduledFireAt: now,
  };

  const deps: DeliveryDeps = {
    gameStateStore,
    gameCatalog,
    playerCatalog,
    broadcastCatalog,
    userDirectory,
    persistence: new InMemoryFlagEventPersistence(),
    realtimeBus: new InMemoryRealtimeBus(),
    rateLimitStore: new InMemoryRateLimitStore(),
    pushNotifier,
  };

  await deliverFlagEvent(deps, event, user);

  const call = pushNotifier.calls[0];
  if (!call) {
    console.error('FAIL: deliverFlagEvent did not attempt a push at all.');
    process.exitCode = 1;
    return;
  }

  console.log(`\ntitle: ${call.title}`);
  console.log(`body:  ${call.body}`);
  console.log(`\npayload:\n${JSON.stringify(call.data, null, 2)}\n`);

  const { isFlagEventPayload } = (await import(GUARD_MODULE)) as {
    isFlagEventPayload: (data: unknown) => boolean;
  };

  if (!isFlagEventPayload(call.data)) {
    console.error(
      'FAIL: the app guard REJECTS this payload. A push would arrive and the tap would do nothing.',
    );
    process.exitCode = 1;
    return;
  }

  // The guard is deliberately shallow (5 fields), so check the rest of what the app actually renders
  // and routes on — a payload that passes the guard but has a null deep link still cannot switch.
  const payload = call.data as CheckedPayload;
  const problems: string[] = [];
  if (payload.action.deep_link_url === null) problems.push('action.deep_link_url is null (tap cannot route)');
  if (payload.game_summary.possession_team === null) problems.push('game_summary.possession_team is null');
  if (payload.flagged_players.length === 0) problems.push('flagged_players is empty');
  if (payload.game_summary.home_team_primary_color === '') problems.push('team colors missing');

  console.log('PASS: isFlagEventPayload accepts the real deliverFlagEvent payload.');
  if (problems.length > 0) {
    console.log('\nFields the guard does not check, but the app relies on:');
    for (const problem of problems) console.log(`  WARN  ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log('PASS: deep link, possession, flagged players and team colors all populated.\n');
}

main().catch((error: unknown) => {
  console.error('fatal:', error);
  process.exitCode = 1;
});
