-- Browser Push subscriptions. The web client never reads or writes this table.
-- The API uses the service role. anon and authenticated stay revoked, matching
-- 20261010195000 and 20261010201000. This does not replace users.expo_push_token.

CREATE TABLE public.web_push_subscriptions (
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  device_id text NOT NULL,
  endpoint text PRIMARY KEY,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz
);

COMMENT ON TABLE public.web_push_subscriptions IS
  'Web Push subscriptions for one browser device. service_role only. endpoint is the Push API URL.';

CREATE INDEX web_push_subscriptions_user_id_idx ON public.web_push_subscriptions (user_id);

ALTER TABLE public.web_push_subscriptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.web_push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.web_push_subscriptions TO service_role;
