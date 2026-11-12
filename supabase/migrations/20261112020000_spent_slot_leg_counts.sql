-- Each single and each parlay leg uses one weekly free slot.
ALTER TABLE public.stake_spent_slots
  ADD COLUMN slots integer NOT NULL DEFAULT 1 CHECK (slots >= 1);
