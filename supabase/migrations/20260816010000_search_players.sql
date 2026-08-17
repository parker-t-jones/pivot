-- Player autocomplete search: word-prefix AND across whitespace tokens.
-- See GET /players/search (PLAN.md Section 9).
--
-- search_text is name-only for skill players. Team city/name/abbreviation are
-- appended only for position = 'DEF' so "Lions" finds the Lions defense without
-- surfacing Jared Goff et al. Literal "Defense" still matches via last_name.
--
-- SECURITY: SECURITY INVOKER (not DEFINER). The API invokes this via the service_role
-- key, which already has GRANT ALL on players/teams and bypasses RLS — DEFINER would
-- escalate to the function owner with no benefit. (Contrast handle_new_user, which is
-- DEFINER because an auth trigger must INSERT as owner.) EXECUTE is granted only to
-- service_role; clients never call this RPC directly (they hit Fastify).

CREATE OR REPLACE FUNCTION public.search_players(
  q text,
  filter_position text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  first_name text,
  last_name text,
  "position" text,
  team_id uuid,
  team_abbreviation text,
  team_name text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH tokens AS (
    SELECT lower(tok) AS token
    FROM unnest(regexp_split_to_array(trim(BOTH FROM q), '\s+')) AS tok
    WHERE length(tok) > 0
  ),
  candidates AS (
    SELECT
      p.id,
      p.first_name,
      p.last_name,
      p.position,
      p.team_id,
      t.abbreviation AS team_abbreviation,
      t.name AS team_name,
      lower(
        trim(
          BOTH FROM CASE
            WHEN p.position = 'DEF' THEN concat_ws(
              ' ',
              NULLIF(p.first_name, ''),
              NULLIF(p.last_name, ''),
              t.city,
              t.name,
              t.abbreviation
            )
            ELSE concat_ws(
              ' ',
              NULLIF(p.first_name, ''),
              NULLIF(p.last_name, '')
            )
          END
        )
      ) AS search_text
    FROM public.players p
    INNER JOIN public.teams t ON t.id = p.team_id
    WHERE p.active = true
      AND (filter_position IS NULL OR p.position = filter_position)
  )
  SELECT
    c.id,
    c.first_name,
    c.last_name,
    c.position,
    c.team_id,
    c.team_abbreviation,
    c.team_name
  FROM candidates c
  WHERE EXISTS (SELECT 1 FROM tokens)
    AND NOT EXISTS (
      SELECT 1
      FROM tokens tok
      WHERE NOT EXISTS (
        SELECT 1
        FROM unnest(regexp_split_to_array(c.search_text, '\s+')) AS word
        WHERE word LIKE replace(replace(replace(tok.token, '\', '\\'), '%', '\%'), '_', '\_') || '%'
          ESCAPE '\'
      )
    )
  ORDER BY c.last_name ASC, c.first_name ASC
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION public.search_players(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_players(text, text) TO service_role;
