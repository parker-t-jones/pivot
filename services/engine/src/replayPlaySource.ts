import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import { parse } from 'csv-parse';
import type { PlayEvent, PlayType } from './playEvent.js';
import type { PlaySource } from './types.js';

/** A raw nflverse play-by-play CSV row (subset of columns the engine consumes; all values strings). */
export interface NflverseRow {
  play_id?: string;
  game_id?: string;
  home_team?: string;
  away_team?: string;
  week?: string;
  posteam?: string;
  defteam?: string;
  yardline_100?: string;
  quarter_seconds_remaining?: string;
  qtr?: string;
  play_type?: string;
  two_point_attempt?: string;
  timeout?: string;
  quarter_end?: string;
  total_home_score?: string;
  total_away_score?: string;
  posteam_score_post?: string;
  defteam_score_post?: string;
  [column: string]: string | undefined;
}

function text(value: string | undefined): string {
  return (value ?? '').trim();
}

/** Empty string or nflverse's `"NA"` sentinel → null; otherwise the trimmed value. */
function nullable(value: string | undefined): string | null {
  const t = text(value);
  return t === '' || t === 'NA' ? null : t;
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(nullable(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numOrNull(value: string | undefined): number | null {
  const t = nullable(value);
  if (t === null) return null;
  const parsed = Number(t);
  return Number.isFinite(parsed) ? parsed : null;
}

const NFLVERSE_PLAY_TYPES: ReadonlySet<PlayType> = new Set<PlayType>([
  'pass',
  'run',
  'punt',
  'field_goal',
  'kickoff',
  'extra_point',
  'qb_kneel',
  'qb_spike',
]);

/**
 * Normalizes an nflverse `play_type` (+ related columns) into our source-agnostic `PlayType`.
 * Two-point conversions carry `play_type` `pass`/`run` in nflverse but are flagged separately via
 * `two_point_attempt`; we surface them as `'two_point_attempt'` (still an offensive scrimmage play).
 */
function toPlayType(r: NflverseRow): PlayType {
  if (text(r.two_point_attempt) === '1') return 'two_point_attempt';

  const raw = nullable(r.play_type);
  if (raw !== null && NFLVERSE_PLAY_TYPES.has(raw as PlayType)) return raw as PlayType;

  // No scrimmage play_type: distinguish control rows (timeouts, quarter ends) from generic no-plays.
  if (text(r.timeout) === '1') return 'timeout';
  if (text(r.quarter_end) === '1') return 'end_period';
  return 'no_play';
}

/**
 * Score after the current play, in home/away perspective.
 *
 * nflverse `total_home_score`/`total_away_score` (and `posteam_score`/`defteam_score`) are *pre-play*
 * running totals, so on a scoring play they lag by one play — which would flag a false-positive
 * `close_game` on the scoring play itself. The parallel `posteam_score_post`/`defteam_score_post`
 * columns are post-play, so we use those and translate from possessing/defending perspective to
 * home/away via `posteam` vs `home_team`. On rows with no possessing team (kickoffs, timeouts,
 * end-of-quarter) the `*_post` columns are absent; there we fall back to the pre-play running totals,
 * which are correct as the current score for a non-scoring, non-scrimmage row.
 */
function scoreAfterPlay(r: NflverseRow): { home: number; away: number } {
  const possessor = nullable(r.posteam);
  const possessorPost = numOrNull(r.posteam_score_post);
  const defenderPost = numOrNull(r.defteam_score_post);

  if (possessor !== null && possessorPost !== null && defenderPost !== null) {
    return possessor === text(r.home_team)
      ? { home: possessorPost, away: defenderPost }
      : { home: defenderPost, away: possessorPost };
  }

  return { home: num(r.total_home_score, 0), away: num(r.total_away_score, 0) };
}

/** Pure map of one nflverse row → normalized `PlayEvent`. `isFinalPlay` is decided by the caller. */
export function mapNflverseRow(r: NflverseRow, isFinalPlay: boolean): PlayEvent {
  const score = scoreAfterPlay(r);
  return {
    playId: text(r.play_id),
    gameId: text(r.game_id),
    week: num(r.week, 0),
    homeTeamId: text(r.home_team),
    awayTeamId: text(r.away_team),
    possessionTeamId: nullable(r.posteam),
    playType: toPlayType(r),
    scoreHome: score.home,
    scoreAway: score.away,
    quarter: num(r.qtr, 0),
    secondsRemainingInQuarter: num(r.quarter_seconds_remaining, 0),
    yardsToOpponentEndzone: numOrNull(r.yardline_100),
    isFinalPlay,
  };
}

export interface ReplayPlaySourceOptions {
  /** Path to a gzipped nflverse play-by-play CSV (e.g. `data/nflverse/play_by_play_2024.csv.gz`). */
  filePath: string;
  /** nflverse `game_id` to replay (e.g. `2024_08_KC_LV`). */
  gameId: string;
  /** Delay between emitted plays. Default 0 (fast tests); set to real timing for a demo. */
  delayMs?: number;
}

/**
 * File-backed `PlaySource` (PLAN.md Section 2 swap-ready boundary). Reads recorded nflverse
 * play-by-play, filters to a single game, and emits normalized `PlayEvent`s in order with a
 * configurable delay. The real live-feed source is `@pivot/ingestion`'s `EspnPlaySource`
 * (Section 5/8); this replay source remains useful for deterministic tests/demos independent
 * of ESPN's live endpoint.
 */
export class ReplayPlaySource implements PlaySource {
  readonly id = 'replay' as const;
  private disconnected = false;

  constructor(private readonly options: ReplayPlaySourceOptions) {}

  async subscribe(handler: (play: PlayEvent) => Promise<void>): Promise<void> {
    const plays = await this.loadPlays();
    for (const play of plays) {
      if (this.disconnected) return;
      await handler(play);
      if (this.options.delayMs && this.options.delayMs > 0) {
        await delay(this.options.delayMs);
      }
    }
  }

  async disconnect(): Promise<void> {
    this.disconnected = true;
  }

  /** Streams the gzipped CSV, keeps only this game's rows, and marks the last one as the final play. */
  private async loadPlays(): Promise<PlayEvent[]> {
    const parser = createReadStream(this.options.filePath)
      .pipe(createGunzip())
      .pipe(parse({ columns: true, skipEmptyLines: true, relaxQuotes: true, relaxColumnCount: true }));

    const rows: NflverseRow[] = [];
    for await (const record of parser as AsyncIterable<NflverseRow>) {
      if (text(record.game_id) === this.options.gameId) rows.push(record);
    }

    const lastIndex = rows.length - 1;
    return rows.map((r, i) => mapNflverseRow(r, i === lastIndex));
  }
}
