/**
 * Seeds `public.game_broadcasts` with fixture routing data (Sprint 7 Phase 4) so the Section 9
 * `GET /games/:id/broadcasts` endpoint, the dispatcher's `recommended_source`/`deep_link_url`
 * enrichment, and the Home-screen "Switch" CTA all have something real to resolve against in dev.
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
 * Idempotent: deletes existing rows for the seeded games, then re-inserts (there is no
 * UNIQUE(game_id, service) constraint to upsert on, and this sprint adds no migrations).
 *
 * Usage: `pnpm seed:broadcasts` from the repo root.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../services/api/.env'), quiet: true });

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
};

export interface BroadcastSeedRow {
  game_id: string;
  service: string;
  deep_link_url: string;
  requires_subscription: boolean;
}

/** Free over-the-air network assigned round-robin across games (real matchups aren't known without
 *  Sportradar schedule data — Sprint 2, deferred). Fixture-only. */
const OTA_ROTATION = ['fox', 'cbs', 'nbc', 'abc'] as const;

export function otaForIndex(gameIndex: number): string {
  return OTA_ROTATION[gameIndex % OTA_ROTATION.length] ?? 'fox';
}

/**
 * Fixture broadcast set per game: one rotating free OTA network plus two paid streaming options
 * (Sunday Ticket + NFL+). Enough to exercise eligibility ranking (free vs. paid), the `preferred`
 * tiebreak, and the CTA against a user's `user_app_presence` — not a claim about who actually airs
 * a given matchup.
 */
export function buildBroadcastRows(gameId: string, gameIndex: number): BroadcastSeedRow[] {
  const services = [otaForIndex(gameIndex), 'sunday_ticket', 'nfl_plus'];
  const rows: BroadcastSeedRow[] = [];
  for (const service of services) {
    const template = BROADCAST_TEMPLATES[service];
    if (!template) continue;
    rows.push({
      game_id: gameId,
      service: template.service,
      deep_link_url: template.deepLinkUrl,
      requires_subscription: template.requiresSubscription,
    });
  }
  return rows;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function seedBroadcasts(): Promise<void> {
  const supabaseUrl = process.env['SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Set them in services/api/.env.');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  console.log(`Fetching games from ${supabaseUrl}...`);
  const { data: games, error: gamesError } = await supabase
    .from('games')
    .select('id')
    .order('scheduled_start', { ascending: true });
  if (gamesError) throw gamesError;
  if (!games || games.length === 0) {
    throw new Error('No games found. Seed the schedule before seeding broadcasts.');
  }

  const gameIds = games.map((g) => g.id);

  console.log(`Clearing existing broadcasts for ${gameIds.length} games (idempotent re-seed)...`);
  const { error: deleteError } = await supabase.from('game_broadcasts').delete().in('game_id', gameIds);
  if (deleteError) throw deleteError;

  const rows = games.flatMap((game, index) => buildBroadcastRows(game.id, index));

  console.log(`Inserting ${rows.length} broadcast rows (${games.length} games x 3)...`);
  for (const batch of chunk(rows, 500)) {
    const { error } = await supabase.from('game_broadcasts').insert(batch);
    if (error) throw error;
  }

  console.log('Done. ⚠️ Deep links are UNVERIFIED placeholders (Open Question #2 audit pending).');
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  seedBroadcasts().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
