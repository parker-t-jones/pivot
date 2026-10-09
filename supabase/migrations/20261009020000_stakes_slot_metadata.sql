-- Display metadata for the Lineup opponent group. The engine does not read these.
ALTER TABLE public.stakes
  ADD COLUMN slot_label text,
  ADD COLUMN slot_index smallint;
