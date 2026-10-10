-- Which device the single Expo token belongs to. Null means the current TestFlight
-- client, treated as device id legacy-ios. public.users already has no privileges for
-- anon or authenticated (20261010201000). This adds a column only. service_role already
-- holds ALL on the table, so the API can write it. Do not grant to anon or authenticated.
-- Deploy Tue–Thu only, separately from the grant-lock migrations, never Fri–Mon.

ALTER TABLE public.users
  ADD COLUMN expo_push_device_id text;

COMMENT ON COLUMN public.users.expo_push_device_id IS
  'Device id sent with POST /me/push-token. Null is the legacy iOS client.';
