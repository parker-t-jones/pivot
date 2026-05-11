CREATE TABLE public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sportradar_id text UNIQUE,
  abbreviation text NOT NULL,
  name text NOT NULL,
  city text NOT NULL,
  conference text NOT NULL,
  division text NOT NULL,
  primary_color text NOT NULL,
  secondary_color text NOT NULL,
  CONSTRAINT teams_abbreviation_key UNIQUE (abbreviation)
);

CREATE TABLE public.players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sportradar_id text UNIQUE,
  sleeper_id text UNIQUE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  position text NOT NULL,
  team_id uuid NOT NULL REFERENCES public.teams (id),
  active boolean NOT NULL DEFAULT true,
  jersey_number int
);

CREATE INDEX players_team_id_position_idx ON public.players (team_id, position);

CREATE TABLE public.games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sportradar_id text UNIQUE,
  season_year int NOT NULL,
  week int NOT NULL,
  scheduled_start timestamptz NOT NULL,
  home_team_id uuid NOT NULL REFERENCES public.teams (id),
  away_team_id uuid NOT NULL REFERENCES public.teams (id),
  status text NOT NULL,
  venue text
);

CREATE INDEX games_week_scheduled_start_idx ON public.games (week, scheduled_start);
CREATE INDEX games_scheduled_start_idx ON public.games (scheduled_start);

CREATE TABLE public.game_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES public.games (id),
  service text NOT NULL CHECK (public.is_valid_streaming_service (service)),
  deep_link_url text NOT NULL,
  requires_subscription boolean NOT NULL
);

CREATE INDEX game_broadcasts_game_id_idx ON public.game_broadcasts (game_id);

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_broadcasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY teams_select_authenticated
  ON public.teams
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY players_select_authenticated
  ON public.players
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY games_select_authenticated
  ON public.games
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY game_broadcasts_select_authenticated
  ON public.game_broadcasts
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.teams TO authenticated;
GRANT SELECT ON public.players TO authenticated;
GRANT SELECT ON public.games TO authenticated;
GRANT SELECT ON public.game_broadcasts TO authenticated;

GRANT ALL ON public.teams TO service_role;
GRANT ALL ON public.players TO service_role;
GRANT ALL ON public.games TO service_role;
GRANT ALL ON public.game_broadcasts TO service_role;
