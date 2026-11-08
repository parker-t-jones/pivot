-- Final score for a finished game (issue #14). The runner writes both columns when it marks a
-- game final, from the ESPN scoreboard event's competitor scores. GET /games?week= returns them
-- as `final_score`. NULL until the game is final, and for games finalized before this column
-- existed (the API falls back to the Redis game_state while that key is alive).

ALTER TABLE public.games
  ADD COLUMN home_score integer CHECK (home_score IS NULL OR home_score >= 0),
  ADD COLUMN away_score integer CHECK (away_score IS NULL OR away_score >= 0);

COMMENT ON COLUMN public.games.home_score IS
  'Final home score. Written by the runner when status becomes final. NULL otherwise.';

COMMENT ON COLUMN public.games.away_score IS
  'Final away score. Written by the runner when status becomes final. NULL otherwise.';
