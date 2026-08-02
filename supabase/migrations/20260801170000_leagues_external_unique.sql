-- Prevent duplicate Sleeper (and other external) league connections per user.
-- Partial unique index: manual leagues keep external_league_id NULL and are unaffected.
-- Existing duplicate rows are NOT cleaned up here — apply after manual dedupe if needed.
CREATE UNIQUE INDEX leagues_user_id_platform_external_league_id_uidx
  ON public.leagues (user_id, platform, external_league_id)
  WHERE external_league_id IS NOT NULL;
