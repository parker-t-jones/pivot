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
 * from the drive and ignores yardline/down/distance whenever nobody has the ball.
 */
export const espnPlayStartSchema = z.object({
  team: z.object({ id: z.string().optional() }).optional(),
  yardsToEndzone: z.number().optional(),
  /** Current down (1–4). Meaningful only on scrimmage plays — see file header. */
  down: z.number().optional(),
  /** Yards to go for a first down. Meaningful only on scrimmage plays — see file header. */
  distance: z.number().optional(),
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
  /**
   * ESPN's real-time timestamp for this play. A bad value is dropped so logging it cannot fail the poll.
   */
  wallclock: z.string().optional().catch(undefined),
  /**
   * Post-play situation. `end.team.id` is the ESPN team id that has the ball once the play is over,
   * which on a punt, turnover, or kickoff is the receiving team (docs/R1-EARLY-NUDGE-FINDINGS.md §5:
   * present on 850 of 850 live non-procedural plays). A malformed block is dropped, not fatal.
   */
  end: z
    .object({ team: z.object({ id: z.string().optional() }).optional() })
    .optional()
    .catch(undefined),
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
      /** `postponed` / `canceled` / `cancelled` / `delayed` live here. A substring match beats `state === 'in'`. */
      name: z.string().optional(),
    })
    .optional(),
  /** 1–4, or 5 in overtime. Scoreboard events carry this next to `displayClock`. */
  period: z.number().optional(),
  /** Game clock as `M:SS`, e.g. `'8:41'`. */
  displayClock: z.string().optional(),
});

export const espnCompetitorSchema = z.object({
  id: z.string(),
  homeAway: z.enum(['home', 'away']),
  team: z.object({ abbreviation: z.string().optional() }).optional(),
  /** Running score. The scoreboard sends a string; a number is accepted too. */
  score: z.union([z.string(), z.number()]).optional(),
  /** Points per period on the summary header (Q1 first, then OT). Read by `parseEspnPlayerStats`. */
  linescores: z
    .array(
      z.object({
        value: z.number().optional().catch(undefined),
        displayValue: z.string().optional().catch(undefined),
      }),
    )
    .optional()
    .catch(undefined),
});

/**
 * One event from `.../scoreboard`. Shares `espnCompetitorSchema`/`espnStatusSchema` with the summary
 * schema below — confirmed identical shape on both endpoints (`competitor.id`, `competitor.team.
 * abbreviation`, `status.type.{state,completed}`), which is what makes reusing them safe rather than
 * coincidental.
 */
export const espnScoreboardEventSchema = z.object({
  id: z.string(),
  shortName: z.string().optional().catch(undefined),
  date: z.string().optional().catch(undefined),
  competitions: z
    .array(
      z.object({
        competitors: z.array(espnCompetitorSchema).optional(),
        status: espnStatusSchema.optional(),
        // Broadcast fields `parseEspnAirings` reads (B1 §3.1). Each falls back to undefined so a
        // malformed broadcast block can't fail the scoreboard discovery and reconcile also read.
        broadcast: z.string().optional().catch(undefined),
        broadcasts: z
          .array(
            z.object({
              market: z.string().optional(),
              names: z.array(z.string()).optional(),
            }),
          )
          .optional()
          .catch(undefined),
        geoBroadcasts: z
          .array(
            z.object({
              type: z.object({ shortName: z.string().optional() }).optional(),
              market: z.object({ type: z.string().optional() }).optional(),
              media: z.object({ shortName: z.string().optional() }).optional(),
            }),
          )
          .optional()
          .catch(undefined),
      }),
    )
    .optional(),
  status: espnStatusSchema.optional(),
});

export const espnScoreboardSchema = z.object({
  events: z.array(espnScoreboardEventSchema).optional(),
});

/**
 * Summary `boxscore.players`: one entry per team, each with stat groups (`passing`, `rushing`, ...)
 * whose `keys` name the columns of every athlete's `stats` strings. Parsed leniently: a malformed
 * boxscore is dropped (`catch`) so it can never fail the play poll.
 */
export const espnBoxscoreSchema = z.object({
  players: z
    .array(
      z.object({
        team: z.object({ abbreviation: z.string().optional() }).optional(),
        statistics: z
          .array(
            z.object({
              name: z.string().optional(),
              keys: z.array(z.string()).optional(),
              athletes: z
                .array(
                  z.object({
                    athlete: z.object({
                      id: z.string(),
                      displayName: z.string().optional(),
                    }),
                    stats: z.array(z.string()).optional(),
                  }),
                )
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

/** Summary `scoringPlays`, in game order. */
export const espnScoringPlaySchema = z.object({
  type: z.object({ abbreviation: z.string().optional() }).optional(),
  scoringType: z.object({ name: z.string().optional() }).optional(),
  period: z.object({ number: z.number().optional() }).optional(),
  team: z.object({ abbreviation: z.string().optional() }).optional(),
  text: z.string().optional(),
});

export const espnSummarySchema = z.object({
  boxscore: espnBoxscoreSchema.optional().catch(undefined),
  scoringPlays: z.array(espnScoringPlaySchema).optional().catch(undefined),
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
export type EspnBoxscore = z.infer<typeof espnBoxscoreSchema>;
export type EspnScoringPlay = z.infer<typeof espnScoringPlaySchema>;
export type EspnScoreboardEvent = z.infer<typeof espnScoreboardEventSchema>;
export type EspnScoreboard = z.infer<typeof espnScoreboardSchema>;
