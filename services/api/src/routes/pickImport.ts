import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { demoAccountFixed, userIsDemo } from '../lib/demoAccount.js';
import { ApiError } from '../lib/errors.js';
import { getCurrentNflState } from '../lib/nfl-state.js';
import {
  MAX_SLIP_LEGS,
  PICK_GAME_COLUMNS,
  validatePick,
  type PickGameRow,
} from '../lib/pickInput.js';
import { escapeLikePrefix } from '../lib/playerSearchText.js';
import {
  SLIP_IMAGE_MAX_BYTES,
  SLIP_IMPORT_BODY_LIMIT,
  type SlipImportLimits,
} from '../lib/slipImport/config.js';
import { mapSlipLeg, type ImportedLeg, type SlipPlayer, type SlipTeam } from '../lib/slipImport/mapSlip.js';
import {
  SLIP_IMPORT_KEY_TTL_SEC,
  slipImportKey,
  type UsageCounter,
} from '../lib/slipImport/quota.js';
import { SlipReadError, sniffImageType, type SlipReader } from '../lib/slipImport/reader.js';
import { requireUser } from '../plugins/auth.js';
import '../plugins/services.js';

export interface PickImportRoutesOptions {
  /** Null when `ANTHROPIC_API_KEY` is unset: the route answers 503 and the app hides the button. */
  reader: SlipReader | null;
  counter: UsageCounter;
  limits: SlipImportLimits;
  now?: () => Date;
}

const bodySchema = z
  .object({
    /** Base64 image, optionally as a `data:` URL. */
    image: z.string().min(1).max(SLIP_IMPORT_BODY_LIMIT),
  })
  .strict();

function unreadable(): ApiError {
  return new ApiError(
    422,
    'slip_import_unreadable',
    'We couldn’t read a bet slip in that image. Try a clearer screenshot, or add the pick yourself.',
  );
}

function limitError(limit: number, isPro: boolean): ApiError {
  const used = `You’ve used today’s ${limit} screenshot imports.`;
  return new ApiError(
    429,
    'slip_import_limit',
    isPro
      ? `${used} You can still add picks yourself, and imports reset tomorrow.`
      : `${used} You can still add picks yourself, imports reset tomorrow, and Pro includes more.`,
    { limit },
  );
}

/** Decoded image bytes, or null when the string is not base64. */
function decodeImage(value: string): Buffer | null {
  const base64 = value.replace(/^data:[^;,]*;base64,/, '').replace(/\s/g, '');
  if (base64.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
  return Buffer.from(base64, 'base64');
}

/**
 * Bet slip screenshot import (#12). Reads the slip with the model, matches each leg to this
 * week's players, teams, and games, and returns legs for the user to review in Add a pick.
 * Nothing is saved here: the user saves through `POST /picks`, where the free cap applies.
 *
 * Privacy: the image and the model's answer stay in memory for this request. Neither is stored
 * or logged; logs carry counts and error kinds only.
 */
const pickImportRoutes: FastifyPluginAsyncZod<PickImportRoutesOptions> = async (
  fastify,
  opts,
) => {
  const now = opts.now ?? (() => new Date());
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.post(
    '/picks/import',
    { schema: { body: bodySchema }, bodyLimit: SLIP_IMPORT_BODY_LIMIT + 1024 },
    async (request) => {
      const user = requireUser(request);
      if (await userIsDemo(fastify.supabase, user.id)) throw demoAccountFixed();
      const reader = opts.reader;
      if (reader === null) {
        throw new ApiError(
          503,
          'slip_import_unavailable',
          'Screenshot import isn’t available right now. Add the pick yourself.',
        );
      }

      const bytes = decodeImage(request.body.image);
      if (bytes === null) {
        throw new ApiError(400, 'slip_image_invalid', 'That file isn’t an image Pivot can read.');
      }
      if (bytes.length > SLIP_IMAGE_MAX_BYTES) {
        throw new ApiError(
          413,
          'slip_image_too_large',
          'That image is too large. Try a smaller screenshot.',
        );
      }
      const mediaType = sniffImageType(bytes);
      if (mediaType === null) {
        throw new ApiError(
          415,
          'slip_image_invalid',
          'That file isn’t an image Pivot can read. Use a PNG or JPEG screenshot.',
        );
      }

      const { data: userRow, error: userError } = await fastify.supabase
        .from('users')
        .select('subscription_tier')
        .eq('id', user.id)
        .single();
      if (userError) throw userError;
      const isPro = userRow.subscription_tier === 'pro';
      const limit = isPro ? opts.limits.pro : opts.limits.free;
      const key = slipImportKey(user.id, now());
      const used = await opts.counter.increment(key, SLIP_IMPORT_KEY_TTL_SEC);
      if (used > limit) {
        await opts.counter.decrement(key);
        throw limitError(limit, isPro);
      }
      const importsLeft = Math.max(0, limit - used);

      let read;
      try {
        read = await reader.read({ mediaType, data: bytes.toString('base64') });
      } catch (error) {
        if (!(error instanceof SlipReadError)) throw error;
        request.log.warn(
          { slipImport: { error: error.reason, status: error.status ?? null } },
          'slip import read failed',
        );
        if (error.reason === 'upstream') {
          // Our side failed, not the user's image: give the import back.
          await opts.counter.decrement(key);
          throw new ApiError(
            502,
            'slip_import_failed',
            'We couldn’t read that screenshot right now. Try again in a minute.',
          );
        }
        throw unreadable();
      }

      if (!read.is_bet_slip || read.legs.length === 0) throw unreadable();
      if (read.bet_count > 1) {
        throw new ApiError(
          422,
          'slip_import_multiple_bets',
          'That screenshot shows more than one bet. Crop it to one bet and try again.',
        );
      }
      if (read.legs.length > MAX_SLIP_LEGS) {
        throw new ApiError(
          422,
          'slip_import_too_many_legs',
          `Pivot tracks parlays of up to ${MAX_SLIP_LEGS} legs.`,
        );
      }

      const nfl = await getCurrentNflState(fastify.lineupCache);
      const season = Number(nfl.season);
      const { data: gameData, error: gamesError } = await fastify.supabase
        .from('games')
        .select(PICK_GAME_COLUMNS)
        .eq('season_year', season)
        .eq('week', nfl.week)
        .eq('season_type', 'regular');
      if (gamesError) throw gamesError;
      const { data: teamData, error: teamsError } = await fastify.supabase
        .from('teams')
        .select('id, abbreviation, city, name');
      if (teamsError) throw teamsError;

      const lookups = {
        games: (gameData ?? []) as PickGameRow[],
        teams: (teamData ?? []) as SlipTeam[],
        findPlayers: async (surname: string): Promise<SlipPlayer[]> => {
          const { data, error } = await fastify.supabase
            .from('players')
            .select('id, first_name, last_name, position, team_id')
            .eq('active', true)
            .ilike('last_name', `%${escapeLikePrefix(surname)}%`)
            .limit(50);
          if (error) throw error;
          return (data ?? []) as SlipPlayer[];
        },
        validate: async (input: Parameters<typeof validatePick>[1]) => {
          await validatePick(fastify.supabase, input, season);
        },
      };

      const legs: ImportedLeg[] = [];
      for (const leg of read.legs) legs.push(await mapSlipLeg(leg, lookups));

      const ready = legs.filter((leg) => leg.status === 'ready').length;
      request.log.info(
        { slipImport: { legs: legs.length, ready, flagged: legs.length - ready } },
        'slip import',
      );
      return {
        kind: legs.length > 1 ? ('parlay' as const) : ('single' as const),
        legs,
        imports_left: importsLeft,
      };
    },
  );
};

export default pickImportRoutes;
