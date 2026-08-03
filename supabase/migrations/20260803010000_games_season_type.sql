-- Sprint 10 Phase 2.5: per-game NFL phase for schedule seed + opener derivation.
-- Pre week N and regular week N both use the same week integer; season_type disambiguates.
-- Composite index covers MIN(scheduled_start) FILTER / WHERE season_type = … opener queries.

ALTER TABLE public.games
  ADD COLUMN season_type text NOT NULL DEFAULT 'regular'
  CHECK (season_type IN ('pre', 'regular', 'post'));

-- Drop the temporary default once existing rows (if any) are stamped; new inserts must set it.
ALTER TABLE public.games ALTER COLUMN season_type DROP DEFAULT;

CREATE INDEX games_season_type_scheduled_start_idx
  ON public.games (season_type, scheduled_start);
