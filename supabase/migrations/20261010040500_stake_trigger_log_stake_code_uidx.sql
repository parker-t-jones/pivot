-- One row per (stake, code). Redis only caches this; the row is what stops a second fire.
CREATE UNIQUE INDEX stake_trigger_log_stake_id_code_uidx
  ON public.stake_trigger_log (stake_id, code);
