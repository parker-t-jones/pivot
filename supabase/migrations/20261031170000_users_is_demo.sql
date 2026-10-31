-- App Review demo account. Default false. Set only by SQL or the service role
-- (scripts/seed-demo-user.ts). The API never accepts this column on a write.

ALTER TABLE public.users
  ADD COLUMN is_demo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.is_demo IS
  'Reviewer demo account. Fixture responses and write blocks key off this. Never set from a client request.';
