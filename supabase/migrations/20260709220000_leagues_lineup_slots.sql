-- Sprint 3: fantasy entities (Section 7). `external_owner_id` / `external_roster_id`
-- are a Sprint 3 addition — see PLAN.md Section 7 divergence note.
CREATE OR REPLACE FUNCTION public.is_valid_league_platform(p text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p IN ('sleeper', 'manual', 'espn', 'yahoo', 'nfl_fantasy', 'cbs');
$$;

CREATE OR REPLACE FUNCTION public.is_valid_slot_type(s text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT s IN ('starter', 'bench', 'flex', 'idp');
$$;

CREATE TABLE public.leagues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (public.is_valid_league_platform (platform)),
  external_league_id text,
  external_owner_id text,
  external_roster_id text,
  name text NOT NULL,
  sport text NOT NULL DEFAULT 'nfl',
  season_year int NOT NULL,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX leagues_user_id_idx ON public.leagues (user_id);

CREATE TABLE public.lineup_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL REFERENCES public.leagues (id) ON DELETE CASCADE,
  week int NOT NULL,
  player_id uuid NOT NULL REFERENCES public.players (id),
  slot_type text NOT NULL CHECK (public.is_valid_slot_type (slot_type)),
  position_in_lineup text NOT NULL,
  is_star boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Sprint 3 addition: lets the lineup sync worker upsert per (league, week, player) instead
  -- of delete+reinsert, which would otherwise clobber `is_star` on every 5-minute sync cycle.
  CONSTRAINT lineup_slots_league_week_player_key UNIQUE (league_id, week, player_id)
);

CREATE INDEX lineup_slots_league_id_week_idx ON public.lineup_slots (league_id, week);

ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lineup_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY leagues_select_own
  ON public.leagues
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY leagues_insert_own
  ON public.leagues
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY leagues_update_own
  ON public.leagues
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY leagues_delete_own
  ON public.leagues
  FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY lineup_slots_select_own
  ON public.lineup_slots
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leagues
      WHERE leagues.id = lineup_slots.league_id
        AND leagues.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY lineup_slots_insert_own
  ON public.lineup_slots
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.leagues
      WHERE leagues.id = lineup_slots.league_id
        AND leagues.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY lineup_slots_update_own
  ON public.lineup_slots
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leagues
      WHERE leagues.id = lineup_slots.league_id
        AND leagues.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.leagues
      WHERE leagues.id = lineup_slots.league_id
        AND leagues.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY lineup_slots_delete_own
  ON public.lineup_slots
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leagues
      WHERE leagues.id = lineup_slots.league_id
        AND leagues.user_id = (SELECT auth.uid())
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leagues TO authenticated;
GRANT ALL ON public.leagues TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lineup_slots TO authenticated;
GRANT ALL ON public.lineup_slots TO service_role;
