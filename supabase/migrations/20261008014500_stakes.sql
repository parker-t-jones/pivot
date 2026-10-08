-- Stakes sit beside leagues and lineup_slots. Nothing reads them yet.
-- `stake_trigger_log` is created empty for a later phase.

CREATE TABLE public.stakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  season int NOT NULL,
  week int NOT NULL,
  game_id text NOT NULL,
  subject jsonb NOT NULL,
  condition jsonb NOT NULL,
  source text NOT NULL,
  source_ref text,
  weight numeric NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stakes_subject_type_check CHECK (
    subject->>'type' IN ('PLAYER', 'TEAM', 'GAME')
  ),
  CONSTRAINT stakes_condition_type_check CHECK (
    condition->>'type' IN (
      'ROSTERED',
      'OPPONENT_ROSTERED',
      'STAT_OVER',
      'STAT_UNDER',
      'MONEYLINE',
      'SPREAD',
      'TOTAL_OVER',
      'TOTAL_UNDER',
      'SURVIVOR'
    )
  ),
  CONSTRAINT stakes_source_check CHECK (
    source IN (
      'SLEEPER_ROSTER',
      'SLEEPER_OPPONENT',
      'MANUAL',
      'KALSHI_MARKET',
      'SHARED_LIST'
    )
  )
);

CREATE INDEX stakes_user_season_week_idx ON public.stakes (user_id, season, week);

CREATE INDEX stakes_game_id_idx ON public.stakes (game_id);

-- One ROSTERED row per player per league (source_ref). A second league is a second row.
CREATE UNIQUE INDEX stakes_rostered_player_uidx
  ON public.stakes (
    user_id,
    season,
    week,
    source,
    coalesce(source_ref, ''),
    (subject->>'playerId')
  )
  WHERE condition->>'type' = 'ROSTERED';

ALTER TABLE public.stakes ENABLE ROW LEVEL SECURITY;

CREATE POLICY stakes_select_own
  ON public.stakes
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY stakes_insert_own
  ON public.stakes
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY stakes_update_own
  ON public.stakes
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY stakes_delete_own
  ON public.stakes
  FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stakes TO authenticated;
GRANT ALL ON public.stakes TO service_role;

CREATE TABLE public.stake_trigger_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stake_id uuid NOT NULL REFERENCES public.stakes (id) ON DELETE CASCADE,
  code text NOT NULL,
  drive_key text NOT NULL,
  fired_at timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('NUDGE', 'REVEAL'))
);

CREATE INDEX stake_trigger_log_stake_id_idx ON public.stake_trigger_log (stake_id);

ALTER TABLE public.stake_trigger_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY stake_trigger_log_select_own
  ON public.stake_trigger_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.stakes
      WHERE stakes.id = stake_trigger_log.stake_id
        AND stakes.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY stake_trigger_log_insert_own
  ON public.stake_trigger_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stakes
      WHERE stakes.id = stake_trigger_log.stake_id
        AND stakes.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY stake_trigger_log_update_own
  ON public.stake_trigger_log
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.stakes
      WHERE stakes.id = stake_trigger_log.stake_id
        AND stakes.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stakes
      WHERE stakes.id = stake_trigger_log.stake_id
        AND stakes.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY stake_trigger_log_delete_own
  ON public.stake_trigger_log
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.stakes
      WHERE stakes.id = stake_trigger_log.stake_id
        AND stakes.user_id = (SELECT auth.uid())
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stake_trigger_log TO authenticated;
GRANT ALL ON public.stake_trigger_log TO service_role;
