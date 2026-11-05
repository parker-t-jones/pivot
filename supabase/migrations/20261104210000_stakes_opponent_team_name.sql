-- Fantasy team name for the Watchlist opponent header. The engine does not read this.
ALTER TABLE public.stakes
  ADD COLUMN opponent_team_name text;
