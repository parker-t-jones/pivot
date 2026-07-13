-- Sprint 5 Phase 6: viewing session (Section 7 `viewing_sessions`). One row per user, upserted as
-- the session changes via `/session/*` (Section 9) — unlike `flag_events`, this is user-owned,
-- user-mutable state (same RLS shape as `leagues`), not a service-role-only delivery log.
CREATE OR REPLACE FUNCTION public.is_valid_viewing_session_source(s text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  -- 'embedded' is reserved for the Phase 2 partnership rollout (no `/session/*` endpoint sets it
  -- yet) but must be a valid CHECK value from day one so this migration doesn't need to churn later.
  SELECT s IN ('deeplink', 'airplay', 'chromecast', 'embedded');
$$;

CREATE TABLE public.viewing_sessions (
  user_id uuid PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
  primary_game_id uuid REFERENCES public.games (id),
  primary_source text CHECK (
    primary_source IS NULL OR public.is_valid_viewing_session_source (primary_source)
  ),
  primary_priority_score numeric,
  thumbnail_game_ids uuid[] NOT NULL DEFAULT '{}',
  device_info jsonb NOT NULL DEFAULT '{}',
  started_at timestamptz NOT NULL DEFAULT now(),
  last_updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.viewing_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY viewing_sessions_select_own
  ON public.viewing_sessions
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY viewing_sessions_insert_own
  ON public.viewing_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY viewing_sessions_update_own
  ON public.viewing_sessions
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY viewing_sessions_delete_own
  ON public.viewing_sessions
  FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.viewing_sessions TO authenticated;
GRANT ALL ON public.viewing_sessions TO service_role;
