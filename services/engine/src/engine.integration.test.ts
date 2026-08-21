import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FlagReasonType, UserLineupCache } from '@roster-remote/shared';
import type { Clock } from './clock.js';
import type { PlayEvent } from './playEvent.js';
import { InMemoryGameStateProvider } from './gameStateProvider.js';
import { CapturingEventDispatcher } from './eventDispatcher.js';
import { onPlayEvent, type LineupCacheReader, type OnPlayEventDeps } from './onPlayEvent.js';
import { ReplayPlaySource } from './replayPlaySource.js';

/*
 * End-to-end replay of a real game. Game used: Chiefs @ Raiders, Week 8, 2024-10-27
 * (nflverse game_id `2024_08_KC_LV`). Confirmed present in play_by_play_2024.csv.gz.
 *
 * Test lineup: an offensive player on EACH team (KC + LV) plus LV's defense — so the game is flagged
 * during any offensive drive by either team, and additionally carries a defense reason when KC has
 * the ball (LV defending).
 *
 * Scores are mapped from nflverse POST-play columns (posteam_score_post / defteam_score_post,
 * translated to home/away), so scoreHome/scoreAway reflect the state AFTER the current play. The
 * earlier pre-play mapping (total_home_score / total_away_score) lagged by one play on scoring plays,
 * which produced a one-play false-positive close_game bonus on the scoring play itself.
 *
 * Observed output for this game (deterministic given the recorded data):
 *   plays                = 172
 *   possessionChanges    = 16   (times the ball changed teams)
 *   flag_added           = 32
 *   flag_removed         = 32
 *   priority_increased   = 7
 *   priority_decreased   = 1
 *   reasonTypes          = offense_active, defense_active, red_zone, close_game
 *
 * These aggregate counts are unchanged from the pre-play mapping: close_game is a priority *bonus*
 * (+2), not a flag toggle, so correcting its timing by at most one play shifts *when* the bonus
 * applies on scoring plays but did not move any priority delta across the ±3 event threshold for this
 * game. The fix is validated at the mapping layer in replayPlaySource.test.ts.
 *
 * NOTE on flag_added vs possession changes: the sprint brief anticipated flag_added ≈ possession
 * changes (±1–2). In practice flag_added (32) is ~2× possessionChanges (16). This is CORRECT per the
 * faithful Section 8 rules + the sanctioned nflverse mapping: every special-teams play (punt, FG,
 * kickoff, XP) and every stoppage (timeout / end-of-quarter / no_play → unitOnField 'none') unflags
 * the game, so the flag re-adds on the next offensive snap. With both teams owned, the flag therefore
 * toggles roughly twice per possession (drive start + post-special-teams resume) rather than once per
 * possession change. See sprint report "harder to interpret". We assert the robust invariants below
 * rather than the (optimistic) ±2 match, and do NOT alter the engine to force one.
 */

const GAME_ID = '2024_08_KC_LV';
const HOME = 'LV';
const AWAY = 'KC';
const WEEK = 8;
const USER = 'u1';

const CSV_PATH = fileURLToPath(
  new URL('../../../data/nflverse/play_by_play_2024.csv.gz', import.meta.url),
);

const clock: Clock = () => 1_700_000_000_000;

class StubLineupCache implements LineupCacheReader {
  constructor(private readonly cache: UserLineupCache) {}
  async getLineupCache(userId: string, week: number): Promise<UserLineupCache | null> {
    return userId === this.cache.userId && week === this.cache.week ? this.cache : null;
  }
}

function countPossessionChanges(possessionSeq: (string | null)[]): number {
  let last: string | null = null;
  let changes = 0;
  for (const poss of possessionSeq) {
    if (poss !== null && poss !== last) {
      if (last !== null) changes += 1;
      last = poss;
    }
  }
  return changes;
}

describe('engine integration — replay a real 2024 NFL game (KC @ LV, Week 8)', () => {
  it('replays the full game through onPlayEvent and emits plausible flag events', async () => {
    const lineup: UserLineupCache = {
      userId: USER,
      week: WEEK,
      teamPositions: new Map([
        [AWAY, new Set(['offense'])],
        [HOME, new Set(['offense', 'defense'])],
      ]),
      playerToTeam: new Map([
        ['kc-off', AWAY],
        ['lv-off', HOME],
        ['lv-def', HOME],
      ]),
      starPlayerIds: new Set(),
    };

    const gameState = new InMemoryGameStateProvider();
    gameState.addActiveUser(USER);
    gameState.addStake(AWAY, USER);
    gameState.addStake(HOME, USER);

    const dispatcher = new CapturingEventDispatcher();
    const deps: OnPlayEventDeps = {
      lineupCache: new StubLineupCache(lineup),
      gameState,
      dispatcher,
      clock,
    };

    const possessionSeq: (string | null)[] = [];
    const source = new ReplayPlaySource({ filePath: CSV_PATH, gameId: GAME_ID, delayMs: 0 });
    await source.subscribe(async (play: PlayEvent) => {
      possessionSeq.push(play.possessionTeamId);
      await onPlayEvent(deps, play);
    });

    const events = dispatcher.events;
    const countOf = (t: string): number => events.filter((e) => e.type === t).length;
    const reasonTypes = new Set<FlagReasonType>(
      events.flatMap((e) => e.newState.reasons.map((r) => r.type)),
    );
    const possessionChanges = countPossessionChanges(possessionSeq);

    // --- Core: real game produced a meaningful stream of events ---
    expect(possessionSeq.length).toBeGreaterThan(100); // full game replayed (172 plays)
    expect(events.length).toBeGreaterThan(0);
    expect(countOf('flag_added')).toBeGreaterThan(0);

    // Invariant: the game starts unflagged and ends unflagged (final), so rising edges == falling edges.
    expect(countOf('flag_added')).toBe(countOf('flag_removed'));

    // Flags toggle at least once per possession change (special teams/stoppages add extra toggles).
    expect(countOf('flag_added')).toBeGreaterThanOrEqual(possessionChanges);

    // --- Reasons: real games have red-zone possessions ---
    expect(reasonTypes.has('red_zone')).toBe(true);
    expect(reasonTypes.has('offense_active')).toBe(true);
    expect(reasonTypes.has('defense_active')).toBe(true);

    // --- Game end: status is final and the user's flag was removed ---
    const finalState = await gameState.getGameState(GAME_ID);
    expect(finalState?.status).toBe('final');
    const finalFlag = await gameState.getUserFlagState(USER, GAME_ID);
    expect(finalFlag?.flagged).toBe(false);
    expect(events.at(-1)?.type).toBe('flag_removed');

    // --- No events fire for stakeholders after the game is final ---
    const eventsBefore = events.length;
    const postFinalPlay: PlayEvent = {
      playId: 'post-final',
      gameId: GAME_ID,
      week: WEEK,
      homeTeamId: HOME,
      awayTeamId: AWAY,
      possessionTeamId: AWAY, // interesting change, but status stays final → no flag
      playType: 'run',
      scoreHome: finalState?.scoreHome ?? 0,
      scoreAway: finalState?.scoreAway ?? 0,
      quarter: finalState?.quarter ?? 4,
      secondsRemainingInQuarter: 0,
      yardsToOpponentEndzone: 5,
      isFinalPlay: true,
    };
    await onPlayEvent(deps, postFinalPlay);
    expect(dispatcher.events.length).toBe(eventsBefore);
  }, 120_000);
});
