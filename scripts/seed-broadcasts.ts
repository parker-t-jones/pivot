/**
 * Seeds `public.game_broadcasts` with fixture routing data (Sprint 7 Phase 4) so the Section 9
 * `GET /games/:id/broadcasts` endpoint, the dispatcher's `recommended_source`/`deep_link_url`
 * enrichment, and the Home-screen "Switch" CTA all have something real to resolve against in dev.
 *
 * ⚠️ DEEP LINKS ARE UNVERIFIED. PLAN.md Open Question #2 ("Deep-link availability per service —
 * audit needed before Sprint 7") has NOT been done. Every URL below is a best-effort *app-level*
 * landing URL, NOT a confirmed game-level deep link. This is the honest state per Section 12
 * ("some will support game-level deep links; some only app-level ... build for graceful
 * degradation"): the client opens these via `Linking`, and falls back to its deep-link error state
 * when one can't be opened. Replace these with audited schemes before any real deep-link testing.
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
  /** ⚠️ UNVERIFIED — app-level landing URL placeholder, not an audited game-level deep link. */
  deepLinkUrl: string;
  requiresSubscription: boolean;
}

/** ⚠️ ALL URLs UNVERIFIED (Open Question #2). App-level, not game-level. */
export const BROADCAST_TEMPLATES: Record<string, ServiceTemplate> = {
  sunday_ticket: { service: 'sunday_ticket', deepLinkUrl: 'https://tv.youtube.com/', requiresSubscription: true },
  espn_plus: { service: 'espn_plus', deepLinkUrl: 'https://www.espn.com/watch/', requiresSubscription: true },
  paramount_plus: { service: 'paramount_plus', deepLinkUrl: 'https://www.paramountplus.com/', requiresSubscription: true },
  peacock: { service: 'peacock', deepLinkUrl: 'https://www.peacocktv.com/', requiresSubscription: true },
  amazon_prime: { service: 'amazon_prime', deepLinkUrl: 'https://www.amazon.com/gp/video/', requiresSubscription: true },
  nfl_plus: { service: 'nfl_plus', deepLinkUrl: 'https://www.nfl.com/plus/', requiresSubscription: true },
  nfl_network: { service: 'nfl_network', deepLinkUrl: 'https://www.nfl.com/network/', requiresSubscription: true },
  fox: { service: 'fox', deepLinkUrl: 'https://www.foxsports.com/live', requiresSubscription: false },
  cbs: { service: 'cbs', deepLinkUrl: 'https://www.cbssports.com/live/', requiresSubscription: false },
  nbc: { service: 'nbc', deepLinkUrl: 'https://www.nbcsports.com/live', requiresSubscription: false },
  abc: { service: 'abc', deepLinkUrl: 'https://www.espn.com/watch/', requiresSubscription: false },
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
