-- Manual lineups are stored per week in lineup_slots, and nothing copied them into the next
-- week, so a manual lineup looked deleted every week. manual_lineup_week is the latest week a
-- manual league's lineup was saved or carried to. When the NFL week moves past it, the API and
-- the lineup worker copy that week's slots forward and advance this column. Saving an empty
-- lineup still advances it, so a cleared lineup stays cleared.
-- Null for Sleeper leagues (they re-sync from Sleeper every week) and for a manual league that
-- has never saved a lineup. Additive: the running API ignores the column until it is deployed.

ALTER TABLE public.leagues
  ADD COLUMN manual_lineup_week int;

COMMENT ON COLUMN public.leagues.manual_lineup_week IS
  'Manual leagues: latest week with a saved or carried lineup. The API carries it forward.';

-- Existing manual lineups: start from the latest week that has slots, so the first carry
-- brings back the lineup a user entered most recently.
UPDATE public.leagues AS l
SET manual_lineup_week = latest.week
FROM (
  SELECT league_id, max(week) AS week
  FROM public.lineup_slots
  GROUP BY league_id
) AS latest
WHERE l.id = latest.league_id
  AND l.platform = 'manual';
