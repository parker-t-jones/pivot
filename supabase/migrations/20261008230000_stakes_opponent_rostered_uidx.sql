-- One OPPONENT_ROSTERED row per player per league. Same key as the ROSTERED index.
CREATE UNIQUE INDEX stakes_opponent_rostered_player_uidx
  ON public.stakes (
    user_id,
    season,
    week,
    source,
    coalesce(source_ref, ''),
    (subject->>'playerId')
  )
  WHERE condition->>'type' = 'OPPONENT_ROSTERED';
