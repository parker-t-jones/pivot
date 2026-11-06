-- One Prime Video GTI per game. Keyed by games.id (the game_id GET /games already
-- returns), not the ESPN event id. Rows are inserted by hand. The API uses the
-- service role. anon and authenticated stay revoked, matching user_game_links.

CREATE TABLE public.prime_event_gti (
  game_id text PRIMARY KEY,
  gti text NOT NULL CHECK (gti ~ '^amzn1\.dv\.gti\.[0-9a-f-]{36}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.prime_event_gti IS
  'Prime Video GTI for one game. Keyed by games.id. service_role only.';

COMMENT ON COLUMN public.prime_event_gti.game_id IS
  'games.id. ESPN event ids live on games.sportradar_id as seed:espn:{eventId}.';

ALTER TABLE public.prime_event_gti ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.prime_event_gti FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.prime_event_gti TO service_role;
