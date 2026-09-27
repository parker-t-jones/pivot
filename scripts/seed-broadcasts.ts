/**
 * Seeds `public.game_broadcasts` from a real ESPN scoreboard (B1.2, docs/B1-BROADCAST-DESIGN.md §6):
 * saved JSON (default `experiments/logs/espn-scoreboard-2026-week3.json`) or `--live` for the
 * current week. Airings go through the same `parseEspnAirings` as production and join to `games` on
 * `sportradar_id = 'seed:espn:' || event.id`.
 *
 * Temporary compatibility dump: writes the old `game_broadcasts` shape as *networks only* — no
 * synthetic `sunday_ticket` / `nfl_plus` rows. `espn` has no row in the `is_valid_streaming_service`
 * CHECK, so ESPN airings are skipped and logged (MNF shows ABC until `game_airings` lands in B1.3).
 *
 * ⚠️ TWO DIFFERENT THINGS ARE AT STAKE HERE, and only the first is verified. Keep them apart.
 *
 * 1. VERIFIED — "does this URL open the app instead of Safari?" Yes, for every URL below except
 *    `cbs`/`nbc`. Each path was checked against the provider's live `apple-app-site-association`
 *    file and is claimed by their *production* app ID (dev/QA/dogfood builds routinely claim paths
 *    the shipping app does not — ESPN is a live example, so match on the production ID only).
 *    `sunday_ticket` was additionally confirmed on a physical iPhone in Sprint 10 Track B.
 * 2. NOT VERIFIED — "is this the right *content*?" No. These remain app-level landing URLs, not
 *    game-level deep links, so they open the provider's app to a generic screen rather than to the
 *    game the user tapped. PLAN.md Open Question #2 ("Deep-link availability per service — audit
 *    needed before Sprint 7") is still open; an AASA file says which paths open an app, never which
 *    paths are valid content. Per-game links need each provider's internal content IDs.
 *
 * Why this distinction earned its own comment: the previous values were bare marketing homepages
 * (`https://tv.youtube.com/`), and providers deliberately exclude those from universal links —
 * YouTube TV's AASA carries a literal `NOT /` rule. So every seeded row silently opened Safari,
 * which looks identical to success from our side (see the `openBroadcast` Known Issue: for an
 * `https` URL, iOS always reports success because Safari handled it, so the Section 10 deep-link
 * error state can never fire). "Opens the right app" is a real improvement over that and is all
 * that is claimed here — it is not the Open Question #2 audit.
 *
 * `cbs` and `nbc` are knowingly left broken: cbssports.com serves an AASA with zero app entries and
 * nbcsports.com serves none at all, so no URL on those domains can open an app. Not fixable by us.
 *
 * Idempotent: deletes existing rows for the games on the scoreboard, then re-inserts (there is no
 * UNIQUE(game_id, service) constraint to upsert on).
 *
 * Usage (repo root):
 *   pnpm seed:broadcasts                     # saved Week 3 scoreboard
 *   pnpm seed:broadcasts -- path/to/scoreboard.json
 *   pnpm seed:broadcasts -- --live           # fetch ESPN's current week
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { parseEspnAirings, type EspnBroadcastEvent, type UnmappedMediaLog } from '@pivot/shared';
import { bootstrapSeedScript, RemoteSafetyError } from './remoteSafety.js';

export interface ServiceTemplate {
  /** Matches the `game_broadcasts.service` / `user_app_presence.service` enum (Section 7). */
  service: string;
  /** Verified to open the provider's production app (AASA-claimed path); NOT an audited game-level
   *  deep link — see the file header for why those are different claims. */
  deepLinkUrl: string;
  requiresSubscription: boolean;
}

/** App-level landing URLs, each claimed by the provider's production app per its AASA (see header).
 *  Opens the right app; does NOT open the right game — Open Question #2 is still open. */
export const BROADCAST_TEMPLATES: Record<string, ServiceTemplate> = {
  // Claimed via the catch-all `*` rule. `/` itself is excluded by a literal `NOT /`, which is what
  // made the old value open Safari. Device-confirmed on a physical iPhone (Sprint 10 Track B).
  sunday_ticket: { service: 'sunday_ticket', deepLinkUrl: 'https://tv.youtube.com/live', requiresSubscription: true },
  // `/watch/*` is ESPN+'s own streaming path but the shipping ESPN app does not claim it — only its
  // dogfood/QA builds do. `/nfl/team` is claimed by production `com.espn.ScoreCenter`.
  espn_plus: { service: 'espn_plus', deepLinkUrl: 'https://www.espn.com/nfl/team', requiresSubscription: true },
  // Unchanged: Paramount+'s AASA claims `/` outright, so the root URL already opened the app.
  paramount_plus: { service: 'paramount_plus', deepLinkUrl: 'https://www.paramountplus.com/', requiresSubscription: true },
  peacock: { service: 'peacock', deepLinkUrl: 'https://www.peacocktv.com/watch/sports', requiresSubscription: true },
  // Prime Video's AASA lives on primevideo.com; amazon.com/gp/video is claimed by no Amazon app.
  amazon_prime: { service: 'amazon_prime', deepLinkUrl: 'https://www.primevideo.com/', requiresSubscription: true },
  nfl_plus: { service: 'nfl_plus', deepLinkUrl: 'https://www.nfl.com/scores', requiresSubscription: true },
  nfl_network: { service: 'nfl_network', deepLinkUrl: 'https://www.nfl.com/scores', requiresSubscription: true },
  // Fox claims `/live/*`, not `/live` — the old value missed by one path segment.
  fox: { service: 'fox', deepLinkUrl: 'https://www.foxsports.com/nfl/scores', requiresSubscription: false },
  // ⚠️ cbs/nbc: no usable AASA on either domain, so these always open Safari. See header.
  cbs: { service: 'cbs', deepLinkUrl: 'https://www.cbssports.com/nfl/scoreboard/', requiresSubscription: false },
  nbc: { service: 'nbc', deepLinkUrl: 'https://www.nbcsports.com/nfl/scores', requiresSubscription: false },
  abc: { service: 'abc', deepLinkUrl: 'https://www.espn.com/nfl/team', requiresSubscription: false },
  // Unverified app-level landings (AASA not audited this pass — Open Question #2).
  hulu: { service: 'hulu', deepLinkUrl: 'https://www.hulu.com/hub/sports', requiresSubscription: true },
  fubo: { service: 'fubo', deepLinkUrl: 'https://www.fubo.tv/', requiresSubscription: true },
  directv: { service: 'directv', deepLinkUrl: 'https://www.directv.com/', requiresSubscription: true },
};

export interface BroadcastSeedRow {
  game_id: string;
  service: string;
  deep_link_url: string;
  requires_subscription: boolean;
}

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SCOREBOARD_PATH = path.resolve(
  scriptsDir,
  '../experiments/logs/espn-scoreboard-2026-week3.json',
);
export const ESPN_LIVE_SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

export type ScoreboardSource = { kind: 'file'; path: string } | { kind: 'live' };

/** Positional scoreboard path or `--live` (remote-safety flags are already stripped). */
export function parseScoreboardSource(rest: readonly string[]): ScoreboardSource {
  let live = false;
  let file: string | undefined;
  for (const arg of rest) {
    if (arg === '--live') {
      live = true;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`seed:broadcasts: unknown flag ${arg}`);
    }
    if (file !== undefined) {
      throw new Error('seed:broadcasts: pass at most one scoreboard path.');
    }
    file = arg;
  }
  if (live && file !== undefined) {
    throw new Error('seed:broadcasts: --live and a scoreboard path are mutually exclusive.');
  }
  return live ? { kind: 'live' } : { kind: 'file', path: path.resolve(file ?? DEFAULT_SCOREBOARD_PATH) };
}

/** `games.sportradar_id` written by `seed:schedule` for an ESPN event. */
export function espnGameExternalId(eventId: string): string {
  return `seed:espn:${eventId}`;
}

export interface SkippedAiring {
  eventId: string;
  shortName: string | undefined;
  network: string;
}

export interface NetworkRowsResult {
  rows: BroadcastSeedRow[];
  /** Airings with no `game_broadcasts` service (today only `espn`, blocked by the CHECK). */
  skipped: SkippedAiring[];
  /** Scoreboard events with no seeded game. */
  unmatchedEventIds: string[];
}

/** One network-only row per distinct airing network per game. */
export function buildNetworkRows(
  events: readonly EspnBroadcastEvent[],
  gameIdByExternalId: ReadonlyMap<string, string>,
  logUnmapped: UnmappedMediaLog,
): NetworkRowsResult {
  const rows: BroadcastSeedRow[] = [];
  const skipped: SkippedAiring[] = [];
  const unmatchedEventIds: string[] = [];

  for (const event of events) {
    const gameId = gameIdByExternalId.get(espnGameExternalId(event.id));
    if (gameId === undefined) {
      unmatchedEventIds.push(event.id);
      continue;
    }
    const seen = new Set<string>();
    for (const airing of parseEspnAirings(event, logUnmapped)) {
      if (seen.has(airing.network)) continue;
      seen.add(airing.network);
      const template = BROADCAST_TEMPLATES[airing.network];
      if (!template) {
        skipped.push({ eventId: event.id, shortName: event.shortName, network: airing.network });
        continue;
      }
      rows.push({
        game_id: gameId,
        service: template.service,
        deep_link_url: template.deepLinkUrl,
        requires_subscription: template.requiresSubscription,
      });
    }
  }

  return { rows, skipped, unmatchedEventIds };
}

interface ScoreboardBody {
  events?: EspnBroadcastEvent[];
}

async function loadScoreboardEvents(source: ScoreboardSource): Promise<EspnBroadcastEvent[]> {
  let body: ScoreboardBody;
  if (source.kind === 'live') {
    console.log(`Fetching live scoreboard from ${ESPN_LIVE_SCOREBOARD_URL}...`);
    const response = await fetch(ESPN_LIVE_SCOREBOARD_URL);
    if (!response.ok) {
      throw new Error(`ESPN scoreboard request failed: ${response.status} ${response.statusText}`);
    }
    body = (await response.json()) as ScoreboardBody;
  } else {
    console.log(`Reading scoreboard from ${source.path}...`);
    body = JSON.parse(readFileSync(source.path, 'utf8')) as ScoreboardBody;
  }
  const events = body.events ?? [];
  if (events.length === 0) {
    throw new Error('Scoreboard has no events.');
  }
  return events;
}

export async function seedBroadcasts(source: ScoreboardSource): Promise<void> {
  const supabaseUrl = process.env['SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Set them in services/api/.env.');
  }

  const events = await loadScoreboardEvents(source);
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const externalIds = events.map((event) => espnGameExternalId(event.id));
  const { data: games, error: gamesError } = await supabase
    .from('games')
    .select('id, sportradar_id')
    .in('sportradar_id', externalIds);
  if (gamesError) throw gamesError;
  const gameIdByExternalId = new Map<string, string>(
    (games ?? []).map((game: { id: string; sportradar_id: string }) => [game.sportradar_id, game.id]),
  );
  if (gameIdByExternalId.size === 0) {
    throw new Error('No scoreboard events match seeded games. Run `pnpm seed:schedule` first.');
  }

  const { rows, skipped, unmatchedEventIds } = buildNetworkRows(events, gameIdByExternalId, (info) => {
    console.warn(
      `unmapped media "${info.rawName}" on ${info.shortName ?? '?'} (${info.eventId}) via ${info.source} — skipped`,
    );
  });
  for (const eventId of unmatchedEventIds) {
    console.warn(`no seeded game for ESPN event ${eventId} (${espnGameExternalId(eventId)}) — skipped`);
  }
  for (const skip of skipped) {
    console.warn(
      `skip ${skip.network} on ${skip.shortName ?? '?'} (${skip.eventId}): not a game_broadcasts service`,
    );
  }

  const gameIds = [...gameIdByExternalId.values()];
  console.log(`Clearing existing broadcasts for ${gameIds.length} games (idempotent re-seed)...`);
  const { error: deleteError } = await supabase.from('game_broadcasts').delete().in('game_id', gameIds);
  if (deleteError) throw deleteError;

  if (rows.length > 0) {
    console.log(`Inserting ${rows.length} network rows...`);
    const { error: insertError } = await supabase.from('game_broadcasts').insert(rows);
    if (insertError) throw insertError;
  }

  console.log(`Done. ${rows.length} rows, ${skipped.length} skipped airings, ${unmatchedEventIds.length} unmatched events.`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const cli = bootstrapSeedScript({
      argv: process.argv.slice(2),
      scriptName: 'seed:broadcasts',
      forbidRemoteAlways: true,
    });
    seedBroadcasts(parseScoreboardSource(cli.rest)).catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = error instanceof RemoteSafetyError ? error.exitCode : 1;
  }
}
