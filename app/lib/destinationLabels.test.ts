import type { FlagEvent } from '@pivot/shared';
import {
  resolveDestinations,
  type DestinationGame,
  type ResolverService,
} from '@pivot/shared/broadcast';
import { notificationBody } from '@pivot/dispatcher';
import { describe, expect, it } from 'vitest';

import { watchBroadcastLabel, watchCta } from './gameDisplay';
import { watchButtonLabel } from './liveStakeCards';
import { watchlistPlayerRow } from './watchlistTable';

const KICKOFF = new Date('2026-10-04T17:00:00Z');

function game(rawNames: readonly string[], patch?: Partial<DestinationGame>): DestinationGame {
  return {
    awayNickname: 'Bears',
    homeNickname: 'Falcons',
    kickoff: KICKOFF,
    airings: rawNames.map((rawName) => ({ rawName })),
    savedUrl: null,
    outOfMarketSunday: false,
    ...patch,
  };
}

const SCENARIOS: {
  airings: readonly string[];
  services: readonly ResolverService[];
  patch?: Partial<DestinationGame>;
}[] = [
  { airings: ['CBS'], services: ['directv'] },
  { airings: ['FOX'], services: ['directv'] },
  { airings: ['NBC'], services: ['directv'] },
  { airings: ['ABC'], services: ['directv'] },
  { airings: ['ESPN'], services: ['espn'] },
  { airings: ['CBS'], services: ['paramount_plus'] },
  { airings: ['NBC'], services: ['peacock'] },
  { airings: ['CBS'], services: ['youtube_tv'] },
  { airings: ['FOX'], services: ['sunday_ticket'], patch: { outOfMarketSunday: true } },
  { airings: ['Prime Video'], services: ['amazon_prime'] },
  { airings: [], services: ['youtube_tv'] },
  {
    airings: ['CBS'],
    services: ['directv'],
    patch: { savedUrl: 'https://example.com/saved' },
  },
];

const EVENT: FlagEvent = {
  id: 'evt-1',
  userId: 'u1',
  gameId: 'g1',
  type: 'flag_added',
  oldState: null,
  newState: {
    gameId: 'g1',
    flagged: true,
    priorityScore: 1,
    reasons: [{ type: 'offense_active', triggeringPlayerIds: [] }],
    computedAt: 0,
  },
  scheduledFireAt: 0,
};

describe('destination labels', () => {
  it('never renders a destination note', () => {
    const notes = new Set<string>();
    const rendered: string[] = [];

    for (const scenario of SCENARIOS) {
      const result = resolveDestinations(game(scenario.airings, scenario.patch), scenario.services);
      expect(result.kind).toBe('destinations');
      if (result.kind !== 'destinations') continue;

      for (const destination of [result.primary, ...result.alternates]) {
        notes.add(destination.note);
        expect(destination.label).not.toBe(destination.note);
      }

      const cta = watchCta([], [], result);
      expect(cta.kind).toBe('watch');
      if (cta.kind !== 'watch') continue;
      rendered.push(watchBroadcastLabel(cta.broadcast));
      rendered.push(watchButtonLabel([], [], result));
      for (const alternate of cta.alternates ?? []) {
        rendered.push(alternate.label ?? alternate.deep_link_url);
      }
      rendered.push(
        notificationBody(
          EVENT,
          {
            possessionTeamName: 'Falcons',
            defenseTeamName: 'Bears',
            quarter: 2,
            timeRemainingSec: 434,
            yardsToOpponentEndzone: null,
            down: null,
            distance: null,
          },
          null,
          result.primary.label,
        ),
      );

      const row = watchlistPlayerRow({
        id: 'slot-1',
        slot: 'WR',
        name: 'Davante Adams',
        meta: 'LAR · WR',
        teamAbbr: 'SF',
        weekGames: [
          {
            game_id: 'g1',
            status: 'in_progress',
            scheduled_start: '2026-10-12T17:00:00.000Z',
            home_team: 'SEA',
            away_team: 'SF',
            airings: [],
            broadcasts: [],
            destination: result,
          },
        ],
        liveGames: [],
        now: KICKOFF,
        timeZone: 'America/New_York',
      });
      if (row.watchLabel !== null) rendered.push(row.watchLabel);
    }

    expect(rendered.length).toBeGreaterThan(0);
    for (const text of rendered) {
      expect(notes.has(text)).toBe(false);
      for (const note of notes) expect(text).not.toContain(note);
    }
  });
});
