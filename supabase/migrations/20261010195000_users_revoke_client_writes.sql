-- The app client never writes public.users. Default privileges had granted anon and
-- authenticated INSERT, UPDATE, DELETE, and TRUNCATE. RLS does not apply to TRUNCATE.
-- users_update_own stays, so any future column grant is still limited to auth.uid().
-- service_role keeps full write for the RevenueCat webhook. handle_new_user is
-- SECURITY DEFINER owned by postgres, so signup still inserts subscription_tier = 'free'.
-- Do not apply this to production before Tuesday, and never Friday through Monday.

REVOKE ALL ON TABLE public.users FROM anon, authenticated;

GRANT SELECT ON TABLE public.users TO authenticated;

GRANT ALL ON TABLE public.users TO service_role;
