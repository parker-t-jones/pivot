-- B1.3a (docs/B1-BROADCAST-DESIGN.md §1.1–1.4, §2.2): split the mixed streaming-service enum
-- into airing networks and user services, remap presence, and add game_airings.
-- Do not rewrite 20260510120000 / 20260510120100 / 20260918120000.

-- 1. Remap presence (§2.2). The old CHECK rejects youtube_tv / hulu_live, so drop it first;
--    step 3 re-adds it against is_valid_user_service.
ALTER TABLE public.user_app_presence DROP CONSTRAINT user_app_presence_service_check;

DELETE FROM public.user_app_presence
WHERE service IN ('cbs', 'fox', 'nbc', 'abc', 'nfl_network');

-- The "YouTube TV" toggle was stored as sunday_ticket; Sunday Ticket returns later as its own key.
UPDATE public.user_app_presence SET service = 'youtube_tv' WHERE service = 'sunday_ticket';
UPDATE public.user_app_presence SET service = 'hulu_live' WHERE service = 'hulu';

-- 2. Split catalogs.
-- §1.3: keys allowed on game_airings.network (not picker values).
CREATE FUNCTION public.is_valid_airing_network(s text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT s IN (
    'cbs',
    'fox',
    'nbc',
    'abc',
    'espn',
    'amazon_prime',
    'peacock',
    'nfl_network',
    'netflix',
    'espn_plus',
    'nfl_plus',
    'paramount_plus'
  );
$$;

-- §1.4: keys allowed on user_app_presence.service (picker values).
CREATE FUNCTION public.is_valid_user_service(s text)
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
    'amazon_prime',
    'peacock',
    'paramount_plus',
    'espn_plus',
    'nfl_plus'
  );
$$;

-- 3. Point existing CHECKs at the new functions, then drop the old one.
ALTER TABLE public.user_app_presence
  ADD CONSTRAINT user_app_presence_service_check CHECK (public.is_valid_user_service (service));

-- game_broadcasts holds networks only since B1.2 (retired in B1.4b).
ALTER TABLE public.game_broadcasts DROP CONSTRAINT game_broadcasts_service_check;
ALTER TABLE public.game_broadcasts
  ADD CONSTRAINT game_broadcasts_service_check CHECK (public.is_valid_airing_network (service));

DROP FUNCTION public.is_valid_streaming_service(text);

-- 4. game_airings (§1.2): one row per observed airing. Empty until the seed/ingest writer lands.
CREATE TABLE public.game_airings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES public.games (id),
  network text NOT NULL CHECK (public.is_valid_airing_network (network)),
  market text NOT NULL CHECK (market IN ('national', 'regional', 'unknown')),
  source text NOT NULL CHECK (source IN ('espn_scoreboard', 'espn_scoreboard_fixture')),
  espn_media_name text NOT NULL,
  espn_type text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT game_airings_game_id_network_market_key UNIQUE (game_id, network, market)
);

CREATE INDEX game_airings_game_id_idx ON public.game_airings (game_id);

ALTER TABLE public.game_airings ENABLE ROW LEVEL SECURITY;

CREATE POLICY game_airings_select_authenticated
  ON public.game_airings
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.game_airings TO authenticated;
GRANT ALL ON public.game_airings TO service_role;
