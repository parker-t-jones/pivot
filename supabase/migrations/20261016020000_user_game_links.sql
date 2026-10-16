-- One saved stream URL per user per game. The app never reads or writes this table.
-- The API uses the service role. anon and authenticated stay revoked, matching
-- 20261010195000 and 20261010201000.

CREATE TABLE public.user_game_links (
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  game_id uuid NOT NULL REFERENCES public.games (id) ON DELETE CASCADE,
  url text NOT NULL CHECK (char_length(url) <= 2048),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_id)
);

COMMENT ON TABLE public.user_game_links IS
  'Direct stream URL a user saved for one game. service_role only.';

ALTER TABLE public.user_game_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_game_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.user_game_links TO service_role;
