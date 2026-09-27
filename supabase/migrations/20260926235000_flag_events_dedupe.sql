-- P0.6: one delivered flag per user, game, event type, and triggering play.
-- NULL triggering_play_id values stay distinct, so rows that are not live events are not collapsed.
CREATE UNIQUE INDEX flag_events_user_game_type_play_uidx
  ON public.flag_events (user_id, game_id, event_type, triggering_play_id);
