-- P0.8: a push that fails after the flag_events row exists is retried from that row.
-- push_status stays null when no push was attempted.
ALTER TABLE public.flag_events
  ADD COLUMN push_status text CHECK (
    push_status IS NULL OR push_status IN ('sent', 'pending', 'dropped')
  ),
  ADD COLUMN push_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN push_last_error text,
  ADD COLUMN push_next_attempt_at timestamptz,
  ADD COLUMN push_payload jsonb;
