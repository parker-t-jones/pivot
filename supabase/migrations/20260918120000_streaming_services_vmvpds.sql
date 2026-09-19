-- Expand the Section 7 streaming-service enum with vMVPDs (Hulu, Fubo, DIRECTV).
-- CHECK constraints on user_app_presence.service and game_broadcasts.service call this
-- function, so replacing it is enough — do not rewrite 20260510120000.
CREATE OR REPLACE FUNCTION public.is_valid_streaming_service(s text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT s IN (
    'sunday_ticket',
    'espn_plus',
    'paramount_plus',
    'peacock',
    'amazon_prime',
    'nfl_plus',
    'nfl_network',
    'hulu',
    'fubo',
    'directv',
    'fox',
    'cbs',
    'nbc',
    'abc'
  );
$$;
