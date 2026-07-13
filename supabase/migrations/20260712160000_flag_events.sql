-- Sprint 5: flag event delivery log (Section 7 `flag_events`). Written by the dispatcher's
-- `deliverFlagEvent` (service role) once a deferred event clears the liveness/staleness and
-- rate-limit gates (Section 8) — never by the client directly.
CREATE OR REPLACE FUNCTION public.is_valid_flag_event_type(t text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT t IN ('flag_added', 'flag_removed', 'priority_increased', 'priority_decreased');
$$;

CREATE OR REPLACE FUNCTION public.is_valid_flag_user_action(a text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT a IN ('switched', 'added_to_split', 'dismissed', 'ignored');
$$;

CREATE TABLE public.flag_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  game_id uuid NOT NULL REFERENCES public.games (id),
  event_type text NOT NULL CHECK (public.is_valid_flag_event_type (event_type)),
  triggering_play_id text,
  priority_score numeric NOT NULL,
  reasons jsonb NOT NULL,
  fired_at timestamptz NOT NULL,
  delivered_at timestamptz,
  user_action text CHECK (user_action IS NULL OR public.is_valid_flag_user_action (user_action))
);

CREATE INDEX flag_events_user_id_fired_at_idx ON public.flag_events (user_id, fired_at DESC);

ALTER TABLE public.flag_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY flag_events_select_own
  ON public.flag_events
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

GRANT SELECT ON public.flag_events TO authenticated;
GRANT ALL ON public.flag_events TO service_role;
