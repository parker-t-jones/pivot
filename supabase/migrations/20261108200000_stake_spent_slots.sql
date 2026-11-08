-- A free weekly pick slot stays spent once the pick's game has kicked off, even if the
-- pick is removed. DELETE /stakes/:id writes a row here before it deletes a started pick
-- that counts toward the free cap. POST /stakes counts these rows plus the week's live
-- picks. stake_id has no foreign key on purpose: the stake row is gone after the delete.
-- The API uses the service role. anon and authenticated stay revoked.

CREATE TABLE public.stake_spent_slots (
  stake_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  season int NOT NULL,
  week int NOT NULL,
  game_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.stake_spent_slots IS
  'Free-cap picks removed after kickoff. Each row keeps one weekly slot spent. service_role only.';

CREATE INDEX stake_spent_slots_user_season_week_idx
  ON public.stake_spent_slots (user_id, season, week);

ALTER TABLE public.stake_spent_slots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.stake_spent_slots FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.stake_spent_slots TO service_role;
