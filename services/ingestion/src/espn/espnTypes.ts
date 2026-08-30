import { z } from 'zod';

/**
 * Runtime schemas for the slice of ESPN's unofficial summary endpoint this service consumes
 * (`site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={id}`).
 *
 * ESPN's API is undocumented and can change without notice (PLAN.md Section 5), which is exactly why
 * the response is validated at the boundary instead of trusted: `espnClient` parses into these types
 * and a failure is reported rather than allowed to flow malformed data into the engine.
 *
 * Two deliberate scope choices:
 *
 * 1. Only fields `mapEspnPlay`/`resolveGameContext` actually read appear here. Unknown keys are
 *    stripped (zod's default for `z.object`), so ESPN *adding* fields is a no-op; only removing or
 *    retyping a field we depend on trips validation.
 * 2. Almost everything is optional. Just `play.id` (the dedupe key) and `play.type.id` (the input to
 *    classification) are required, because a play missing either is genuinely unusable. The rest fall
 *    back to documented defaults in the mapper — dropping a whole poll cycle over an absent game
 *    clock would cost us plays, and missing plays is the failure mode resumption detection can least
 *    afford.
 *
 * Every shape below was confirmed against real responses: event 401873308 (Colts @ Lions,
 * 2026-08-29) in full, plus 16 further games spanning preseason, regular season, and playoffs.
 */

/** ESPN's structured play classification, e.g. `{ id: '74', text: 'Official Timeout' }`. */
export const espnPlayTypeSchema = z.object({
  id: z.string(),
  /** Human-readable label. Logged for diagnostics; `id` is what we classify on. */
  text: z.string().optional(),
});

/**
 * Pre-play situation. ESPN sends this on every play, but it is only meaningful on scrimmage plays:
 * on procedural entries it is actively misleading. Observed on real timeouts, `start.team.id` names a
 * team that contradicts the drive's offense (a timeout inside a DET drive reported team `11`/IND),
 * and `yardsToEndzone` is `0` or stale (`58` on an End Period entry). So the mapper takes possession
 * from the drive and ignores both fields whenever nobody has the ball.
 */
export const espnPlayStartSchema = z.object({
  team: z.object({ id: z.string().optional() }).optional(),
  yardsToEndzone: z.number().optional(),
});

export const espnPlaySchema = z.object({
  id: z.string(),
  type: espnPlayTypeSchema,
  text: z.string().optional(),
  period: z.object({ number: z.number().optional() }).optional(),
  /** Game clock as `M:SS`, e.g. `'13:28'`. Parsed to seconds by the mapper. */
  clock: z.object({ displayValue: z.string().optional() }).optional(),
  start: espnPlayStartSchema.optional(),
  /**
   * Running score *after* this play, home/away perspective. Verified post-play across a full game:
   * every scoring play already carries its own points, so unlike nflverse (whose `total_*_score`
   * columns lag a play and need a `*_post` correction) these can be used directly.
   */
  homeScore: z.number().optional(),
  awayScore: z.number().optional(),
});

export const espnDriveSchema = z.object({
  /** The drive's offense — the reliable possession signal (see `espnPlayStartSchema`). */
  team: z.object({ id: z.string().optional(), abbreviation: z.string().optional() }).optional(),
  plays: z.array(espnPlaySchema).optional(),
});

export const espnStatusSchema = z.object({
  type: z
    .object({
      state: z.string().optional(),
      completed: z.boolean().optional(),
    })
    .optional(),
});

export const espnCompetitorSchema = z.object({
  id: z.string(),
  homeAway: z.enum(['home', 'away']),
  team: z.object({ abbreviation: z.string().optional() }).optional(),
});

/**
 * One event from `.../scoreboard`. Shares `espnCompetitorSchema`/`espnStatusSchema` with the summary
 * schema below — confirmed identical shape on both endpoints (`competitor.id`, `competitor.team.
 * abbreviation`, `status.type.{state,completed}`), which is what makes reusing them safe rather than
 * coincidental.
 */
export const espnScoreboardEventSchema = z.object({
  id: z.string(),
  competitions: z
    .array(
      z.object({
        competitors: z.array(espnCompetitorSchema).optional(),
      }),
    )
    .optional(),
  status: espnStatusSchema.optional(),
});

export const espnScoreboardSchema = z.object({
  events: z.array(espnScoreboardEventSchema).optional(),
});

export const espnSummarySchema = z.object({
  header: z
    .object({
      /** Week number as a bare number (not an object) — verified on 2025 and 2026 responses. */
      week: z.number().optional(),
      competitions: z
        .array(
          z.object({
            competitors: z.array(espnCompetitorSchema).optional(),
            status: espnStatusSchema.optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  drives: z
    .object({
      /** Completed drives, oldest first. */
      previous: z.array(espnDriveSchema).optional(),
      /** The in-progress drive — present only while a game is live, absent once it goes final. */
      current: espnDriveSchema.optional(),
    })
    .optional(),
});

export type EspnPlayType = z.infer<typeof espnPlayTypeSchema>;
export type EspnPlay = z.infer<typeof espnPlaySchema>;
export type EspnDrive = z.infer<typeof espnDriveSchema>;
export type EspnCompetitor = z.infer<typeof espnCompetitorSchema>;
export type EspnSummary = z.infer<typeof espnSummarySchema>;
export type EspnScoreboardEvent = z.infer<typeof espnScoreboardEventSchema>;
export type EspnScoreboard = z.infer<typeof espnScoreboardSchema>;
