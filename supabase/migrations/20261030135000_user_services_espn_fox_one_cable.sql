-- Picker values for the ESPN app, FOX One, and other cable.
-- `espn` is the app. It is not `espn_plus`, and it is not an airing-network write.

CREATE OR REPLACE FUNCTION public.is_valid_user_service(s text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT s IN (
    'youtube_tv',
    'sunday_ticket',
    'hulu_live',
    'fubo',
    'directv',
    'sling',
    'cable_other',
    'amazon_prime',
    'peacock',
    'paramount_plus',
    'fox_one',
    'espn',
    'espn_plus',
    'nfl_plus'
  );
$$;
