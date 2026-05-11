-- Streaming services allowed on user_app_presence.service and game_broadcasts.service (Section 7).
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
    'fox',
    'cbs',
    'nbc',
    'abc'
  );
$$;

CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email text NOT NULL,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  subscription_tier text NOT NULL DEFAULT 'free' CHECK (subscription_tier IN ('free', 'pro')),
  expo_push_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_key UNIQUE (email)
);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.users (id, email, preferences, subscription_tier)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    '{}'::jsonb,
    'free'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.user_app_presence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  service text NOT NULL CHECK (public.is_valid_streaming_service (service)),
  has_subscription boolean NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_app_presence_user_id_service_key UNIQUE (user_id, service)
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_app_presence ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_own
  ON public.users
  FOR SELECT
  TO authenticated
  USING (id = (SELECT auth.uid()));

CREATE POLICY users_update_own
  ON public.users
  FOR UPDATE
  TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY user_app_presence_select_own
  ON public.user_app_presence
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY user_app_presence_insert_own
  ON public.user_app_presence
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY user_app_presence_update_own
  ON public.user_app_presence
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY user_app_presence_delete_own
  ON public.user_app_presence
  FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT, UPDATE ON public.users TO authenticated;
GRANT ALL ON public.users TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_app_presence TO authenticated;
GRANT ALL ON public.user_app_presence TO service_role;
