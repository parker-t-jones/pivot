-- The app client uses Supabase for auth only. It does not read or write public tables,
-- so anon and authenticated keep no privileges on them. service_role keeps full access
-- for the API. handle_new_user stays a SECURITY DEFINER trigger owned by postgres.
-- Ship this with 20261010195000 on Tuesday at the earliest, never Friday through Monday.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Signup inserts into auth.users as supabase_auth_admin, which must still be able to
-- fire this trigger. It is not granted to anon or authenticated.
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;

DROP POLICY IF EXISTS users_select_own ON public.users;
DROP POLICY IF EXISTS users_update_own ON public.users;

DROP POLICY IF EXISTS user_app_presence_select_own ON public.user_app_presence;
DROP POLICY IF EXISTS user_app_presence_insert_own ON public.user_app_presence;
DROP POLICY IF EXISTS user_app_presence_update_own ON public.user_app_presence;
DROP POLICY IF EXISTS user_app_presence_delete_own ON public.user_app_presence;

DROP POLICY IF EXISTS leagues_select_own ON public.leagues;
DROP POLICY IF EXISTS leagues_insert_own ON public.leagues;
DROP POLICY IF EXISTS leagues_update_own ON public.leagues;
DROP POLICY IF EXISTS leagues_delete_own ON public.leagues;

DROP POLICY IF EXISTS lineup_slots_select_own ON public.lineup_slots;
DROP POLICY IF EXISTS lineup_slots_insert_own ON public.lineup_slots;
DROP POLICY IF EXISTS lineup_slots_update_own ON public.lineup_slots;
DROP POLICY IF EXISTS lineup_slots_delete_own ON public.lineup_slots;

DROP POLICY IF EXISTS viewing_sessions_select_own ON public.viewing_sessions;
DROP POLICY IF EXISTS viewing_sessions_insert_own ON public.viewing_sessions;
DROP POLICY IF EXISTS viewing_sessions_update_own ON public.viewing_sessions;
DROP POLICY IF EXISTS viewing_sessions_delete_own ON public.viewing_sessions;

DROP POLICY IF EXISTS stakes_select_own ON public.stakes;
DROP POLICY IF EXISTS stakes_insert_own ON public.stakes;
DROP POLICY IF EXISTS stakes_update_own ON public.stakes;
DROP POLICY IF EXISTS stakes_delete_own ON public.stakes;

DROP POLICY IF EXISTS stake_trigger_log_select_own ON public.stake_trigger_log;
DROP POLICY IF EXISTS stake_trigger_log_insert_own ON public.stake_trigger_log;
DROP POLICY IF EXISTS stake_trigger_log_update_own ON public.stake_trigger_log;
DROP POLICY IF EXISTS stake_trigger_log_delete_own ON public.stake_trigger_log;

DROP POLICY IF EXISTS flag_events_select_own ON public.flag_events;
DROP POLICY IF EXISTS teams_select_authenticated ON public.teams;
DROP POLICY IF EXISTS players_select_authenticated ON public.players;
DROP POLICY IF EXISTS games_select_authenticated ON public.games;
DROP POLICY IF EXISTS game_airings_select_authenticated ON public.game_airings;

-- Migrations run as postgres, which is not a superuser and cannot change supabase_admin's
-- defaults. Tables and functions created by later migrations use these privileges.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
