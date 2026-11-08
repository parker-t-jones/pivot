-- Player props, team/game props, and parlays (docs/P2-PICKS-MODEL.md). Requires
-- 20261108200000_stake_spent_slots.sql. Existing picks keep working unchanged.

-- ESPN athlete id so boxscore stats can be matched to players. Filled by seed:players.
ALTER TABLE public.players ADD COLUMN espn_id text;

CREATE UNIQUE INDEX players_espn_id_uidx ON public.players (espn_id) WHERE espn_id IS NOT NULL;

-- A parlay. Its legs are stakes rows with slip_id set. The slip uses one free slot.
CREATE TABLE public.pick_slips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  season int NOT NULL,
  week int NOT NULL,
  kind text NOT NULL DEFAULT 'PARLAY' CHECK (kind IN ('PARLAY')),
  source text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL')),
  result text CHECK (result IN ('won', 'lost', 'tie', 'void')),
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pick_slips IS
  'Parlays. Legs are stakes rows with slip_id. One free slot per slip. service_role only.';

CREATE INDEX pick_slips_user_season_week_idx ON public.pick_slips (user_id, season, week);

ALTER TABLE public.pick_slips ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pick_slips FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.pick_slips TO service_role;

-- Legs and final results. Results are written by the runner when the game is final.
ALTER TABLE public.stakes
  ADD COLUMN slip_id uuid REFERENCES public.pick_slips (id) ON DELETE CASCADE,
  ADD COLUMN result text CHECK (result IN ('won', 'lost', 'tie', 'void')),
  ADD COLUMN result_value numeric,
  ADD COLUMN settled_at timestamptz;

CREATE INDEX stakes_slip_id_idx ON public.stakes (slip_id) WHERE slip_id IS NOT NULL;

ALTER TABLE public.stakes DROP CONSTRAINT stakes_condition_type_check;

ALTER TABLE public.stakes ADD CONSTRAINT stakes_condition_type_check CHECK (
  condition->>'type' IN (
    'ROSTERED',
    'OPPONENT_ROSTERED',
    'STAT_OVER',
    'STAT_UNDER',
    'MONEYLINE',
    'SPREAD',
    'TOTAL_OVER',
    'TOTAL_UNDER',
    'SURVIVOR',
    'PLAYER_EVENT',
    'TEAM_TOTAL_OVER',
    'TEAM_TOTAL_UNDER',
    'FIRST_TO_SCORE',
    'FG_OVER',
    'FG_UNDER'
  )
);

-- Legs are bets only: never fantasy rows or survivor picks.
ALTER TABLE public.stakes ADD CONSTRAINT stakes_slip_leg_type_check CHECK (
  slip_id IS NULL OR condition->>'type' NOT IN ('ROSTERED', 'OPPONENT_ROSTERED', 'SURVIVOR')
);

-- A parlay removed after kickoff keeps one slot spent. For slot_kind = 'slip',
-- stake_id holds the pick_slips id (the slip row is gone after the delete).
ALTER TABLE public.stake_spent_slots
  ADD COLUMN slot_kind text NOT NULL DEFAULT 'stake' CHECK (slot_kind IN ('stake', 'slip'));

COMMENT ON COLUMN public.stake_spent_slots.slot_kind IS
  'stake: stake_id is a stakes.id. slip: stake_id is a pick_slips.id.';
