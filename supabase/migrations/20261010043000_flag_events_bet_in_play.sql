-- `bet_in_play` is delivered through the same flag_events log as a fantasy flag.
CREATE OR REPLACE FUNCTION public.is_valid_flag_event_type(t text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT t IN (
    'flag_added',
    'flag_removed',
    'priority_increased',
    'priority_decreased',
    'bet_in_play'
  );
$$;
