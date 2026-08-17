-- Offseason/preseason roster fallback: store a static player list on the league instead of
-- inventing week-scoped lineup_slots before matchups exist. See PLAN.md Known Issues
-- (Sleeper sync offseason/preseason) and Section 7 `leagues` columns.

CREATE OR REPLACE FUNCTION public.is_valid_lineup_source(s text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT s IN ('matchup', 'roster_fallback');
$$;

ALTER TABLE public.leagues
  ADD COLUMN lineup_source text CHECK (
    lineup_source IS NULL
    OR public.is_valid_lineup_source (lineup_source)
  ),
  ADD COLUMN fallback_roster jsonb;
